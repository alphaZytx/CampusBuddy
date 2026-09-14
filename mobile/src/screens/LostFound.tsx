import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  LOST_FOUND_CATEGORIES,
  type Attachment,
  type LostFoundPost,
} from '@campusbuddy/shared';
import { ApiError, api, query } from '../lib/api';
import { relativeTime } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../state/auth';
import { useToast } from '../state/toast';
import { Screen } from '../components/Layout';
import { Alert, Avatar, Button, EmptyState, ErrorState, Field, Input, LoadingCards, Textarea } from '../components/ui';

const CATEGORY_LABELS: Record<string, string> = {
  ID_AND_CARDS: 'ID & cards', ELECTRONICS: 'Electronics', KEYS: 'Keys', BOOKS_AND_NOTES: 'Books & notes',
  BAGS: 'Bags', CLOTHING: 'Clothing', ACCESSORIES: 'Accessories', SPORTS: 'Sports', OTHER: 'Other',
};

function PostCard({ post }: { post: LostFoundPost }): JSX.Element {
  return <Link to={`/lost-found/${post.id}`} className="card card-link">
    {post.images[0] && <img className="lost-found-cover" src={post.images[0].url} alt="" />}
    <div className="row row--between mb-2">
      <span className={`badge ${post.postType === 'FOUND' ? 'badge--success' : 'badge--accent'}`}>{post.postType === 'LOST' ? 'Lost' : 'Found'}</span>
      <span className="tiny muted">{relativeTime(post.createdAt)}</span>
    </div>
    <h3>{post.title}</h3>
    <p className="small muted clamp-2 mt-2">{post.description}</p>
    <div className="row row--between mt-3 small"><span>📍 {post.approximateLocation}</span><span className="badge">{CATEGORY_LABELS[post.category]}</span></div>
  </Link>;
}

export function LostFound(): JSX.Element {
  const [params,setParams]=useSearchParams(); const navigate=useNavigate();
  const type=params.get('type')??''; const scope=params.get('scope')??'ALL'; const search=params.get('q')??''; const [draft,setDraft]=useState(search);
  const state=useAsync<{posts:LostFoundPost[];hasMore:boolean}>((signal)=>api.get(`/lost-found${query({postType:type||undefined,scope,q:search||undefined,limit:40})}`,signal),[type,scope,search]);
  const set=(key:string,value?:string)=>{const next=new URLSearchParams(params);if(value)next.set(key,value);else next.delete(key);setParams(next,{replace:true});};
  return <Screen title="Lost & Found" back="/">
    <div className="card mb-3"><strong>Keep handovers safe</strong><p className="small muted mt-2">Do not publish exact serial numbers or private identifiers. Verify ownership privately and meet in a public campus location.</p></div>
    <form className="mb-3" onSubmit={(e)=>{e.preventDefault();set('q',draft.trim()||undefined);}}><Input type="search" placeholder="Search item, brand or description…" value={draft} onChange={(e)=>setDraft(e.target.value)} /></form>
    <div className="chip-scroller mb-3">
      {[['','All'],['LOST','Lost'],['FOUND','Found']].map(([value,label])=><button key={label} type="button" className={`chip${type===value?' active':''}`} onClick={()=>set('type',value||undefined)}>{label}</button>)}
    </div>
    <div className="chip-scroller mb-4">
      {[['ALL','Campus'],['MINE','My posts'],['MY_CLAIMS','My responses']].map(([value,label])=><button key={value} type="button" className={`chip${scope===value?' active':''}`} onClick={()=>set('scope',value)}>{label}</button>)}
    </div>
    {state.loading&&!state.data?<LoadingCards/>:state.error?<ErrorState message={state.error} onRetry={state.reload}/>:state.data?.posts.length?<div className="stack">{state.data.posts.map(post=><PostCard key={post.id} post={post}/>)}</div>:<EmptyState emoji="🧭" title="No matching posts" message="Try another filter, or create a Lost or Found post."/>}
    <button type="button" className="fab" onClick={()=>navigate('/lost-found/new')}><span aria-hidden>＋</span> Report item</button>
  </Screen>;
}

export function CreateLostFound(): JSX.Element {
  const navigate=useNavigate();const toast=useToast();const input=useRef<HTMLInputElement>(null);const [params]=useSearchParams();
  const [form,setForm]=useState({postType:params.get('type')==='FOUND'?'FOUND':'LOST',title:'',description:'',category:'OTHER',color:'',brand:'',approximateLocation:'',occurredAt:new Date().toISOString().slice(0,16),verificationQuestion:'What detail can prove this is the right item?'});
  const [photos,setPhotos]=useState<Attachment[]>([]);const [busy,setBusy]=useState(false);const [uploading,setUploading]=useState(false);const [error,setError]=useState<string|null>(null);
  const set=<K extends keyof typeof form>(key:K,value:(typeof form)[K])=>setForm(current=>({...current,[key]:value}));
  async function addPhotos(files:FileList|null){if(!files?.length)return;setUploading(true);setError(null);try{const uploaded:Attachment[]=[];for(const file of Array.from(files).slice(0,5-photos.length)){if(!file.type.startsWith('image/'))throw new Error('Choose image files only.');const result=await api.upload<{attachment:Attachment}>('/uploads?purpose=LOST_FOUND',file,file.name,'POST');uploaded.push(result.attachment);}setPhotos(current=>[...current,...uploaded].slice(0,5));}catch(cause){setError(cause instanceof ApiError?cause.message:(cause as Error).message);}finally{setUploading(false);}}
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError(null);try{const {post}=await api.post<{post:LostFoundPost}>('/lost-found',{...form,occurredAt:new Date(form.occurredAt).toISOString(),color:form.color||null,brand:form.brand||null,verificationQuestion:form.verificationQuestion||null,imageIds:photos.map(p=>p.id)});toast.success(`${form.postType==='LOST'?'Lost':'Found'} item posted.`);navigate(`/lost-found/${post.id}`,{replace:true});}catch(cause){setError(cause instanceof ApiError?cause.message:'Could not create the post.');}finally{setBusy(false);}}
  return <Screen title="Report an item" back="/lost-found"><form onSubmit={submit} className="stack">
    {error&&<Alert tone="error">{error}</Alert>}
    <Field label="What happened?"><div className="segmented"><button type="button" className={form.postType==='LOST'?'active':''} onClick={()=>set('postType','LOST')}>I lost it</button><button type="button" className={form.postType==='FOUND'?'active':''} onClick={()=>set('postType','FOUND')}>I found it</button></div></Field>
    <Field label="Item title"><Input required minLength={3} maxLength={120} value={form.title} onChange={e=>set('title',e.target.value)} placeholder="Black scientific calculator"/></Field>
    <Field label="Public description" hint="Leave out a private detail that only the owner would know."><Textarea required minLength={5} maxLength={2000} rows={5} value={form.description} onChange={e=>set('description',e.target.value)}/></Field>
    <Field label="Category"><select className="select" value={form.category} onChange={e=>set('category',e.target.value)}>{LOST_FOUND_CATEGORIES.map(c=><option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</select></Field>
    <div className="grid-2"><Field label="Colour"><Input maxLength={60} value={form.color} onChange={e=>set('color',e.target.value)}/></Field><Field label="Brand"><Input maxLength={80} value={form.brand} onChange={e=>set('brand',e.target.value)}/></Field></div>
    <Field label="Approximate campus location" hint="Use a building or area, not a precise live location."><Input required minLength={2} maxLength={160} value={form.approximateLocation} onChange={e=>set('approximateLocation',e.target.value)} placeholder="Library, first floor"/></Field>
    <Field label={form.postType==='LOST'?'When did you last have it?':'When did you find it?'}><Input required type="datetime-local" value={form.occurredAt} max={new Date().toISOString().slice(0,16)} onChange={e=>set('occurredAt',e.target.value)}/></Field>
    <Field label="Private verification question" hint="Responses are only visible to you and moderators."><Input maxLength={300} value={form.verificationQuestion} onChange={e=>set('verificationQuestion',e.target.value)}/></Field>
    <input ref={input} hidden type="file" accept="image/*" multiple onChange={e=>void addPhotos(e.target.files)}/>
    {photos.length>0&&<div className="request-photo-grid">{photos.map((photo,index)=><div className="request-photo" key={photo.id}><img src={photo.url} alt={`Item ${index+1}`}/><button type="button" onClick={()=>setPhotos(current=>current.filter(p=>p.id!==photo.id))}>×</button></div>)}</div>}
    <Button type="button" variant="secondary" block loading={uploading} disabled={photos.length>=5} onClick={()=>input.current?.click()}>📷 Add photos ({photos.length}/5)</Button>
    <Button type="submit" size="lg" block loading={busy} disabled={uploading}>Publish {form.postType==='LOST'?'lost':'found'} item</Button>
  </form></Screen>;
}

export function LostFoundDetail(): JSX.Element {
  const {id=''}=useParams();const {user}=useAuth();const toast=useToast();const navigate=useNavigate();const [message,setMessage]=useState('');const [answer,setAnswer]=useState('');const [busy,setBusy]=useState(false);
  const state=useAsync<{post:LostFoundPost}>((signal)=>api.get(`/lost-found/${id}`,signal),[id]);
  async function act(action:string){setBusy(true);try{await api.post(`/lost-found/${id}/actions`,{action});toast.success(action==='MARK_RETURNED'?'Great—item marked returned.':'Post updated.');state.reload();}catch(cause){toast.error(cause instanceof ApiError?cause.message:'Could not update the post.');}finally{setBusy(false);}}
  async function respond(e:FormEvent){e.preventDefault();setBusy(true);try{await api.post(`/lost-found/${id}/claims`,{message,verificationAnswer:answer});toast.success('Your private response was sent.');setMessage('');setAnswer('');state.reload();}catch(cause){toast.error(cause instanceof ApiError?cause.message:'Could not send your response.');}finally{setBusy(false);}}
  async function claimAction(claimId:string,status:string){setBusy(true);try{await api.patch(`/lost-found/${id}/claims/${claimId}`,{status});toast.success('Response updated.');state.reload();}catch(cause){toast.error(cause instanceof ApiError?cause.message:'Could not update the response.');}finally{setBusy(false);}}
  if(state.loading&&!state.data)return <Screen title="Lost & Found" back><LoadingCards/></Screen>;if(state.error||!state.data)return <Screen title="Lost & Found" back><ErrorState message={state.error??'Post not available'} onRetry={state.reload}/></Screen>;
  const post=state.data.post;const mine=post.author.id===user?.id;
  return <Screen title={post.postType==='LOST'?'Lost item':'Found item'} back>
    {post.images.length>0&&<div className="request-photo-grid mb-3">{post.images.map((image,index)=><a href={image.url} target="_blank" rel="noreferrer" key={image.id}><img src={image.url} alt={`${post.title} ${index+1}`}/></a>)}</div>}
    <div className="card stack"><div className="row row--between"><span className={post.postType==='FOUND'?'badge badge--success':'badge badge--accent'}>{post.postType}</span><span className="badge">{post.status}</span></div><h1>{post.title}</h1><p>{post.description}</p><div className="small">📍 {post.approximateLocation}</div><div className="small muted">{CATEGORY_LABELS[post.category]}{post.brand?` · ${post.brand}`:''}{post.color?` · ${post.color}`:''}</div><div className="small muted">Event time: {new Date(post.occurredAt).toLocaleString()}</div></div>
    <Link to={`/users/${post.author.id}`} className="card card-link mt-3"><div className="row"><Avatar user={post.author}/><div><strong>{post.author.fullName}</strong><p className="tiny muted">Verified campus member</p></div></div></Link>
    {post.possibleMatches.length>0&&<><div className="section-title"><h2>Possible matches</h2></div><div className="stack">{post.possibleMatches.map(item=><PostCard key={item.id} post={item}/>)}</div></>}
    {mine&&post.claims.length>0&&<><div className="section-title"><h2>Private responses</h2></div><div className="stack">{post.claims.map(claim=><div className="card" key={claim.id}><div className="row row--between"><strong>{claim.claimant.fullName}</strong><span className="badge">{claim.status}</span></div><p className="small mt-3">{claim.message}</p><div className="alert mt-3"><strong>Verification answer</strong><p className="small mt-2">{claim.verificationAnswer}</p></div>{claim.status==='PENDING'&&<div className="btn-row mt-3"><Button size="sm" variant="secondary" onClick={()=>void claimAction(claim.id,'REJECTED')}>Not a match</Button><Button size="sm" onClick={()=>void claimAction(claim.id,'ACCEPTED')}>Accept match</Button></div>}</div>)}</div></>}
    {!mine&&post.availableActions.includes('CLAIM')&&<form className="card stack mt-3" onSubmit={respond}><h3>{post.postType==='FOUND'?'Is this yours?':'Did you find this?'}</h3><Field label="Message"><Textarea required minLength={5} maxLength={1000} rows={3} value={message} onChange={e=>setMessage(e.target.value)}/></Field><Field label={post.verificationQuestion??'What private detail proves this is the same item?'} hint="Only the post author and moderators can see this answer."><Textarea required minLength={2} maxLength={1000} rows={3} value={answer} onChange={e=>setAnswer(e.target.value)}/></Field><Button type="submit" loading={busy}>Send private response</Button></form>}
    {post.myClaim&&<div className="card mt-3"><strong>Your response: {post.myClaim.status.toLowerCase()}</strong><p className="small muted mt-2">The verification answer stays private.</p>{post.availableActions.includes('WITHDRAW_CLAIM')&&<Button className="mt-3" size="sm" variant="secondary" onClick={()=>void claimAction(post.myClaim!.id,'WITHDRAWN')}>Withdraw response</Button>}</div>}
    <div className="stack mt-4">{mine&&post.availableActions.includes('MARK_RETURNED')&&<Button variant="success" block loading={busy} onClick={()=>void act('MARK_RETURNED')}>Mark item returned</Button>}{mine&&post.availableActions.includes('CLOSE')&&<Button variant="secondary" block onClick={()=>void act('CLOSE')}>Close post</Button>}{mine&&post.availableActions.includes('REOPEN')&&<Button block onClick={()=>void act('REOPEN')}>Reopen for 60 days</Button>}{!mine&&<Button variant="ghost" block onClick={()=>navigate(`/reports/new?targetType=LOST_FOUND&targetId=${post.id}`)}>Report this post</Button>}</div>
  </Screen>;
}
