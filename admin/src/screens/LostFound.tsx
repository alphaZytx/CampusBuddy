import { useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useAsync } from '../lib/useAsync';

interface Row {id:string;post_type:string;title:string;category:string;approximate_location:string;status:string;created_at:string;author_name:string;claim_count:number}

export function LostFoundAdmin(): JSX.Element {
  const state=useAsync<{posts:Row[]}>((signal)=>api.get('/admin/lost-found',signal),[]);
  const [busy,setBusy]=useState<string|null>(null);const [error,setError]=useState<string|null>(null);
  async function update(row:Row,status:Row['status']){const reason=window.prompt(`Reason for changing “${row.title}” to ${status.toLowerCase()}:`);if(!reason)return;setBusy(row.id);setError(null);try{await api.patch(`/admin/lost-found/${row.id}`,{status,reason});state.reload();}catch(cause){setError(cause instanceof ApiError?cause.message:'Could not update the post.');}finally{setBusy(null);}}
  return <section><div className="page-header"><div><h1>Lost & Found</h1><p className="muted">Moderate campus posts and review response activity.</p></div></div>{error&&<div className="alert alert--error mb-3">{error}</div>}{state.loading&&!state.data?<div className="card">Loading…</div>:state.error?<div className="alert alert--error">{state.error}</div>:<div className="card table-wrap"><table><thead><tr><th>Item</th><th>Type</th><th>Author</th><th>Location</th><th>Responses</th><th>Status</th><th>Action</th></tr></thead><tbody>{state.data?.posts.map(row=><tr key={row.id}><td><strong>{row.title}</strong><div className="tiny muted">{row.category.replaceAll('_',' ').toLowerCase()} · {new Date(row.created_at).toLocaleDateString()}</div></td><td>{row.post_type}</td><td>{row.author_name}</td><td>{row.approximate_location}</td><td>{row.claim_count}</td><td><span className="badge">{row.status}</span></td><td>{row.status!=='CLOSED'?<button className="btn btn--danger btn--sm" disabled={busy===row.id} onClick={()=>void update(row,'CLOSED')}>Close</button>:<button className="btn btn--secondary btn--sm" disabled={busy===row.id} onClick={()=>void update(row,'OPEN')}>Reopen</button>}</td></tr>)}</tbody></table></div>}</section>;
}
