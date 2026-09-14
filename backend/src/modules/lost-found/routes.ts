import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  LOST_FOUND_CATEGORIES,
  LOST_FOUND_POST_TYPES,
  createLostFoundClaimSchema,
  createLostFoundPostSchema,
  updateLostFoundClaimSchema,
  updateLostFoundPostSchema,
  type LostFoundClaim,
  type LostFoundPost,
} from '@campusbuddy/shared';
import { requireVerified } from '../../core/context.js';
import { ApiError } from '../../core/errors.js';
import { parseOrThrow } from '../../core/validate.js';
import { withUserTx } from '../../core/outbox.js';
import { toAttachmentsFromJson, toIso, toPublicUserFromJson } from '../../core/serializers.js';
import { notify } from '../notifications/service.js';
import { campusChannel, publish } from '../../realtime/hub.js';
import type { Queryable } from '../../db/client.js';

const idParams = z.object({ id: z.string().uuid('Unknown Lost & Found post') });
const claimParams = z.object({ id: z.string().uuid(), claimId: z.string().uuid() });
const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  postType: z.enum(LOST_FOUND_POST_TYPES).optional(),
  category: z.enum(LOST_FOUND_CATEGORIES).optional(),
  status: z.enum(['OPEN', 'MATCHED', 'RETURNED', 'CLOSED', 'EXPIRED']).optional(),
  scope: z.enum(['ALL', 'MINE', 'MY_CLAIMS']).default('ALL'),
  limit: z.coerce.number().int().min(1).max(50).default(24),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
});
const actionSchema = z.object({ action: z.enum(['MARK_RETURNED', 'CLOSE', 'REOPEN']) });

interface PostRow {
  id: string; campus_id: string; author_id: string; post_type: LostFoundPost['postType'];
  title: string; description: string; category: LostFoundPost['category']; color: string | null;
  brand: string | null; approximate_location: string; occurred_at: Date; verification_question: string | null;
  status: LostFoundPost['status']; expires_at: Date; created_at: Date; updated_at: Date;
  author: unknown; images: unknown;
}

interface ClaimRow {
  id: string; post_id: string; message: string; verification_answer: string;
  status: LostFoundClaim['status']; created_at: Date; updated_at: Date; claimant: unknown;
}

function toClaim(row: ClaimRow): LostFoundClaim {
  const claimant = toPublicUserFromJson(row.claimant);
  if (!claimant) throw new Error('Claim is missing its claimant');
  return { id: row.id, postId: row.post_id, claimant, message: row.message,
    verificationAnswer: row.verification_answer, status: row.status,
    createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at) };
}

function toPost(row: PostRow, viewerId: string, claims: LostFoundClaim[] = [], matches: LostFoundPost[] = []): LostFoundPost {
  const author = toPublicUserFromJson(row.author);
  if (!author) throw new Error('Lost & Found post is missing its author');
  const isAuthor = row.author_id === viewerId;
  const myClaim = claims.find((claim) => claim.claimant.id === viewerId) ?? null;
  const actions: string[] = [];
  if (isAuthor && ['OPEN', 'MATCHED'].includes(row.status)) actions.push('EDIT', 'CLOSE');
  if (isAuthor && row.status === 'MATCHED') actions.push('MARK_RETURNED');
  if (isAuthor && ['CLOSED', 'EXPIRED'].includes(row.status)) actions.push('REOPEN');
  if (!isAuthor && row.status === 'OPEN' && !myClaim) actions.push('CLAIM');
  if (myClaim?.status === 'PENDING') actions.push('WITHDRAW_CLAIM');
  return {
    id: row.id, campusId: row.campus_id, author, postType: row.post_type, title: row.title,
    description: row.description, category: row.category, color: row.color, brand: row.brand,
    approximateLocation: row.approximate_location, occurredAt: toIso(row.occurred_at),
    verificationQuestion: row.verification_question, status: row.status, expiresAt: toIso(row.expires_at),
    images: toAttachmentsFromJson(row.images), myClaim, claims: isAuthor ? claims : [], possibleMatches: matches,
    createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at), availableActions: actions,
  };
}

const POST_SELECT = `
  SELECT p.*, to_jsonb(profile) AS author,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'file_name',a.file_name,
      'mime_type',a.mime_type,'size_bytes',a.size_bytes) ORDER BY i.sort_order),'[]'::jsonb)
       FROM lost_found_images i JOIN attachments a ON a.id=i.attachment_id WHERE i.post_id=p.id) AS images
  FROM lost_found_posts p JOIN public_user_profiles profile ON profile.id=p.author_id`;

const CLAIM_SELECT = `SELECT c.*, to_jsonb(profile) AS claimant FROM lost_found_claims c
  JOIN public_user_profiles profile ON profile.id=c.claimant_id`;

async function claimsFor(tx: Queryable, postId: string): Promise<LostFoundClaim[]> {
  const { rows } = await tx.query<ClaimRow>(`${CLAIM_SELECT} WHERE c.post_id=$1 ORDER BY c.created_at DESC`, [postId]);
  return rows.map(toClaim);
}

export async function lostFoundRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (request) => {
    const user = requireVerified(request);
    const query = parseOrThrow(listQuery, request.query ?? {});
    return withUserTx(request.db, user, async (tx) => {
      const conditions: string[] = []; const params: unknown[] = [];
      const add = (value: unknown): string => { params.push(value); return `$${params.length}`; };
      if (query.scope === 'MINE') conditions.push(`p.author_id=${add(user.id)}`);
      else if (query.scope === 'MY_CLAIMS') conditions.push(`EXISTS (SELECT 1 FROM lost_found_claims c WHERE c.post_id=p.id AND c.claimant_id=${add(user.id)})`);
      else conditions.push(`p.status IN ('OPEN','MATCHED')`);
      if (query.postType) conditions.push(`p.post_type=${add(query.postType)}`);
      if (query.category) conditions.push(`p.category=${add(query.category)}`);
      if (query.status) conditions.push(`p.status=${add(query.status)}`);
      if (query.q) { const term = add(query.q); conditions.push(`(to_tsvector('english',p.title||' '||p.description||' '||coalesce(p.brand,'')) @@ plainto_tsquery('english',${term}) OR p.title ILIKE '%'||${term}||'%')`); }
      const limit = add(query.limit + 1); const offset = add(query.offset);
      const { rows } = await tx.query<PostRow>(`${POST_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY p.created_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const posts = await Promise.all(page.map(async (row) =>
        toPost(row, user.id, query.scope === 'MY_CLAIMS' ? await claimsFor(tx, row.id) : []),
      ));
      return { posts, hasMore };
    });
  });

  app.get('/:id', async (request) => {
    const user = requireVerified(request); const { id } = parseOrThrow(idParams, request.params);
    return withUserTx(request.db, user, async (tx) => {
      const found = await tx.query<PostRow>(`${POST_SELECT} WHERE p.id=$1`, [id]);
      if (!found.rows[0]) throw ApiError.notFound('That Lost & Found post is not available.');
      const row = found.rows[0]; const claims = await claimsFor(tx, id);
      const matches = await tx.query<PostRow>(`${POST_SELECT} WHERE p.id<>$1 AND p.post_type<>$2 AND p.status='OPEN'
        AND (p.category=$3 OR lower(coalesce(p.brand,''))=lower(coalesce($4,'')) OR to_tsvector('english',p.title||' '||p.description) @@ plainto_tsquery('english',$5))
        ORDER BY (p.category=$3)::int DESC, abs(extract(epoch from (p.occurred_at-$6::timestamptz))) ASC LIMIT 6`,
        [id,row.post_type,row.category,row.brand,row.title,row.occurred_at]);
      return { post: toPost(row,user.id,claims,matches.rows.map((match) => toPost(match,user.id))) };
    });
  });

  app.post('/', async (request, reply) => {
    const user = requireVerified(request); const body = parseOrThrow(createLostFoundPostSchema, request.body);
    const post = await withUserTx(request.db, user, async (tx, outbox) => {
      const created = await tx.query<{id:string}>(`INSERT INTO lost_found_posts
        (campus_id,author_id,post_type,title,description,category,color,brand,approximate_location,occurred_at,verification_question)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [user.campusId,user.id,body.postType,body.title,body.description,body.category,body.color||null,body.brand||null,body.approximateLocation,body.occurredAt,body.verificationQuestion||null]);
      for (const [index, attachmentId] of body.imageIds.entries()) await tx.query('INSERT INTO lost_found_images (post_id,attachment_id,sort_order) VALUES ($1,$2,$3)',[created.rows[0].id,attachmentId,index]);
      const opposite = await tx.query<{author_id:string}>(`SELECT DISTINCT author_id FROM lost_found_posts WHERE post_type<>$1 AND status='OPEN' AND author_id<>$2 AND category=$3 AND occurred_at BETWEEN $4::timestamptz-interval '30 days' AND $4::timestamptz+interval '30 days' LIMIT 30`,[body.postType,user.id,body.category,body.occurredAt]);
      for (const match of opposite.rows) await notify(tx,{userId:match.author_id,campusId:user.campusId,type:'LOST_FOUND_POSSIBLE_MATCH',title:'Possible Lost & Found match',body:`A new ${body.postType.toLowerCase()} post may match your item: “${body.title}”.`,data:{lostFoundId:created.rows[0].id,path:`/lost-found/${created.rows[0].id}`},preference:'lost_found',actorId:user.id},outbox);
      outbox.add(() => publish(campusChannel(user.campusId),'LOST_FOUND_POST_CREATED',{lostFoundId:created.rows[0].id}));
      const selected = await tx.query<PostRow>(`${POST_SELECT} WHERE p.id=$1`,[created.rows[0].id]);
      return toPost(selected.rows[0],user.id);
    });
    return reply.code(201).send({post});
  });

  app.patch('/:id', async (request) => {
    const user=requireVerified(request); const {id}=parseOrThrow(idParams,request.params); const body=parseOrThrow(updateLostFoundPostSchema,request.body);
    return withUserTx(request.db,user,async(tx)=>{ const keys:Record<string,unknown>={};
      if(body.title!==undefined)keys.title=body.title;if(body.description!==undefined)keys.description=body.description;if(body.category!==undefined)keys.category=body.category;if(body.color!==undefined)keys.color=body.color;if(body.brand!==undefined)keys.brand=body.brand;if(body.approximateLocation!==undefined)keys.approximate_location=body.approximateLocation;if(body.occurredAt!==undefined)keys.occurred_at=body.occurredAt;if(body.verificationQuestion!==undefined)keys.verification_question=body.verificationQuestion;
      const columns=Object.keys(keys); if(columns.length) {const result=await tx.query(`UPDATE lost_found_posts SET ${columns.map((key,i)=>`${key}=$${i+3}`).join(',')} WHERE id=$1 AND author_id=$2`,[id,user.id,...columns.map(k=>keys[k])]);if(!result.rowCount)throw ApiError.notFound('That post is not available.');}
      const selected=await tx.query<PostRow>(`${POST_SELECT} WHERE p.id=$1`,[id]);if(!selected.rows[0])throw ApiError.notFound('That post is not available.');return {post:toPost(selected.rows[0],user.id,await claimsFor(tx,id))}; });
  });

  app.post('/:id/actions', async(request)=>{const user=requireVerified(request);const {id}=parseOrThrow(idParams,request.params);const {action}=parseOrThrow(actionSchema,request.body);
    return withUserTx(request.db,user,async(tx,outbox)=>{const current=await tx.query<PostRow>(`${POST_SELECT} WHERE p.id=$1 FOR UPDATE OF p`,[id]);const row=current.rows[0];if(!row)throw ApiError.notFound('That post is not available.');if(row.author_id!==user.id)throw ApiError.forbidden('Only the author can update this post.');
      const target=action==='MARK_RETURNED'?'RETURNED':action==='CLOSE'?'CLOSED':'OPEN';if(action==='MARK_RETURNED'&&row.status!=='MATCHED')throw ApiError.conflict('Accept a claim before marking the item returned.');if(action==='REOPEN'&&!['CLOSED','EXPIRED'].includes(row.status))throw ApiError.conflict('Only a closed or expired post can be reopened.');
      await tx.query(`UPDATE lost_found_posts SET status=$2,expires_at=CASE WHEN $2='OPEN' THEN now()+interval '60 days' ELSE expires_at END WHERE id=$1`,[id,target]);
      if(target==='RETURNED'){const accepted=await tx.query<{claimant_id:string}>('SELECT claimant_id FROM lost_found_claims WHERE post_id=$1 AND status=\'ACCEPTED\'',[id]);for(const claim of accepted.rows)await notify(tx,{userId:claim.claimant_id,campusId:user.campusId,type:'LOST_FOUND_RETURNED',title:'Item marked as returned',body:`“${row.title}” has been marked returned.`,data:{lostFoundId:id,path:`/lost-found/${id}`},preference:'lost_found',important:true},outbox);}
      const selected=await tx.query<PostRow>(`${POST_SELECT} WHERE p.id=$1`,[id]);return {post:toPost(selected.rows[0],user.id,await claimsFor(tx,id))};});
  });

  app.post('/:id/claims',async(request,reply)=>{const user=requireVerified(request);const {id}=parseOrThrow(idParams,request.params);const body=parseOrThrow(createLostFoundClaimSchema,request.body);
    const claim=await withUserTx(request.db,user,async(tx,outbox)=>{const post=await tx.query<{author_id:string;campus_id:string;title:string;status:string}>('SELECT author_id,campus_id,title,status FROM lost_found_posts WHERE id=$1',[id]);if(!post.rows[0]||post.rows[0].status!=='OPEN')throw ApiError.conflict('This post is no longer accepting responses.');if(post.rows[0].author_id===user.id)throw ApiError.badRequest('You cannot respond to your own post.');
      const created=await tx.query<ClaimRow>(`INSERT INTO lost_found_claims(post_id,claimant_id,message,verification_answer)
        VALUES($1,$2,$3,$4)
        ON CONFLICT (post_id,claimant_id) DO UPDATE SET message=EXCLUDED.message,
          verification_answer=EXCLUDED.verification_answer,status='PENDING'
        WHERE lost_found_claims.status IN ('WITHDRAWN','REJECTED')
        RETURNING *,null::jsonb AS claimant`,[id,user.id,body.message,body.verificationAnswer]);
      if(!created.rows[0]) throw ApiError.conflict('You already have an active response on this post.');
      await notify(tx,{userId:post.rows[0].author_id,campusId:post.rows[0].campus_id,type:'LOST_FOUND_CLAIM_CREATED',title:'New private Lost & Found response',body:`Someone responded to “${post.rows[0].title}”. Review their verification answer privately.`,data:{lostFoundId:id,path:`/lost-found/${id}`},preference:'lost_found',important:true,actorId:user.id},outbox);
      const full=await tx.query<ClaimRow>(`${CLAIM_SELECT} WHERE c.id=$1`,[created.rows[0].id]);return toClaim(full.rows[0]);});return reply.code(201).send({claim});
  });

  app.patch('/:id/claims/:claimId',async(request)=>{const user=requireVerified(request);const {id,claimId}=parseOrThrow(claimParams,request.params);const {status}=parseOrThrow(updateLostFoundClaimSchema,request.body);
    return withUserTx(request.db,user,async(tx,outbox)=>{const found=await tx.query<{claimant_id:string;author_id:string;campus_id:string;title:string;claim_status:string;post_status:string}>(`SELECT c.claimant_id,p.author_id,p.campus_id,p.title,c.status claim_status,p.status post_status FROM lost_found_claims c JOIN lost_found_posts p ON p.id=c.post_id WHERE c.id=$1 AND p.id=$2 FOR UPDATE OF c,p`,[claimId,id]);const row=found.rows[0];if(!row)throw ApiError.notFound('That response is not available.');
      const authorAction=['ACCEPTED','REJECTED'].includes(status);if(authorAction&&row.author_id!==user.id)throw ApiError.forbidden('Only the post author can review responses.');if(status==='WITHDRAWN'&&row.claimant_id!==user.id)throw ApiError.forbidden('You can only withdraw your own response.');if(!authorAction&&status!=='WITHDRAWN')throw ApiError.badRequest('That response action is not allowed.');if(row.claim_status!=='PENDING')throw ApiError.conflict('That response has already been decided.');if(authorAction&&row.post_status!=='OPEN')throw ApiError.conflict('Reopen the post before reviewing pending responses.');
      await tx.query('UPDATE lost_found_claims SET status=$2 WHERE id=$1',[claimId,status]);if(status==='ACCEPTED'){await tx.query("UPDATE lost_found_claims SET status='REJECTED' WHERE post_id=$1 AND id<>$2 AND status='PENDING'",[id,claimId]);await tx.query("UPDATE lost_found_posts SET status='MATCHED' WHERE id=$1 AND status='OPEN'",[id]);}
      if(authorAction)await notify(tx,{userId:row.claimant_id,campusId:row.campus_id,type:'LOST_FOUND_CLAIM_UPDATED',title:status==='ACCEPTED'?'Your response was accepted':'Your response was not a match',body:status==='ACCEPTED'?`The author accepted your response for “${row.title}”. Arrange a safe public handover.`:`The author reviewed your response for “${row.title}”.`,data:{lostFoundId:id,path:`/lost-found/${id}`},preference:'lost_found',important:status==='ACCEPTED',actorId:user.id},outbox);
      const full=await tx.query<ClaimRow>(`${CLAIM_SELECT} WHERE c.id=$1`,[claimId]);return {claim:toClaim(full.rows[0])};});
  });
}
