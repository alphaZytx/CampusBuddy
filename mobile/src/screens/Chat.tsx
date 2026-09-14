import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Conversation, Message } from '@campusbuddy/shared';
import { ApiError, api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { useRealtime } from '../lib/realtime';
import { clockTime, relativeTime } from '../lib/format';
import { useAuth } from '../state/auth';
import { useToast } from '../state/toast';
import { Screen } from '../components/Layout';
import { Avatar, Button, EmptyState, ErrorState, Input } from '../components/ui';

/** Conversation list (spec §30). */
export function ChatList(): JSX.Element {
  const { user } = useAuth();
  const state = useAsync<{ conversations: Conversation[] }>(
    (signal) => api.get<{ conversations: Conversation[] }>('/conversations', signal),
    [],
  );

  useRealtime(() => state.reload(), { channel: user ? `user:${user.id}` : undefined });

  return (
    <Screen title="Chat">
      {state.loading && !state.data ? (
        <div className="skeleton" style={{ height: 240 }} />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : state.data && state.data.conversations.length > 0 ? (
        <div className="card card--pad-0">
          <div className="list">
            {state.data.conversations.map((conversation) => {
              const other = conversation.participants[0];
              return (
                <Link
                  key={conversation.id}
                  to={`/chat/${conversation.id}`}
                  className={`list-row${conversation.unreadCount > 0 ? ' unread' : ''}`}
                >
                  {other ? <Avatar user={other} /> : <div className="avatar">?</div>}
                  <div className="body">
                    <div className="row row--between">
                      <span className="strong truncate">{other?.fullName ?? 'Conversation'}</span>
                      {conversation.lastMessage && (
                        <span className="tiny subtle">{relativeTime(conversation.lastMessage.createdAt)}</span>
                      )}
                    </div>
                    <div className="small muted truncate">{conversation.subject}</div>
                    {conversation.lastMessage && (
                      <div className="small truncate" style={{ opacity: 0.85 }}>
                        {conversation.lastMessage.body ?? 'Attachment'}
                      </div>
                    )}
                  </div>
                  {conversation.unreadCount > 0 && (
                    <span className="badge badge--accent">{conversation.unreadCount}</span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState
          emoji="💬"
          title="No conversations yet"
          message="A chat opens automatically once you and another student are working on a request together."
        />
      )}
    </Screen>
  );
}

/** One conversation thread. */
export function ChatThread(): JSX.Element {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const state = useAsync<{ messages: Message[] }>(
    (signal) => api.get<{ messages: Message[] }>(`/conversations/${id}/messages`, signal),
    [id],
  );

  // New messages arrive over the socket; the list appends without a refetch.
  useRealtime(
    (event) => {
      const message = event.payload as Message;
      state.setData((current) => {
        const existing = current?.messages ?? [];
        if (existing.some((m) => m.id === message.id)) return { messages: existing };
        return { messages: [...existing, message] };
      });
      // Seen as it arrives, so it must not come back as "unread" in the chat list.
      if (message.sender.id !== user?.id) {
        void api.post(`/conversations/${id}/read`).catch(() => undefined);
      }
    },
    { channel: `conversation:${id}`, events: ['MESSAGE_CREATED'] },
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.data?.messages.length]);

  async function send(event: FormEvent): Promise<void> {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;

    setSending(true);
    setDraft('');
    try {
      const { message } = await api.post<{ message: Message }>(`/conversations/${id}/messages`, { body });
      state.setData((current) => {
        const existing = current?.messages ?? [];
        if (existing.some((m) => m.id === message.id)) return { messages: existing };
        return { messages: [...existing, message] };
      });
    } catch (cause) {
      // Put the text back so nothing is silently lost (spec §84).
      setDraft(body);
      toast.error(cause instanceof ApiError ? cause.message : 'Message not sent. Try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen title="Chat" back flush hideTabs>
      {state.loading && !state.data ? (
        <div className="app-main">
          <div className="skeleton" style={{ height: 300 }} />
        </div>
      ) : state.error ? (
        <div className="app-main">
          <ErrorState message={state.error} onRetry={state.reload} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 56px)' }}>
          <div className="chat-scroll" style={{ flex: 1 }}>
            {state.data?.messages.length === 0 && (
              <EmptyState emoji="👋" title="Say hello" message="Coordinate the details here." />
            )}
            {state.data?.messages.map((message) => {
              const mine = message.sender.id === user?.id;
              return (
                <div key={message.id} className={`bubble${mine ? ' bubble--mine' : ''}`}>
                  {message.body}
                  {message.sharedLat !== null && message.sharedLng !== null && (
                    <a
                      href={`https://www.google.com/maps?q=${message.sharedLat},${message.sharedLng}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'inherit', textDecoration: 'underline' }}
                    >
                      📍 Shared a location
                    </a>
                  )}
                  <time>{clockTime(message.createdAt)}</time>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          <form className="composer" onSubmit={send}>
            <Input
              placeholder="Message…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label="Message"
              maxLength={2000}
            />
            <Button type="submit" disabled={!draft.trim()} loading={sending}>
              Send
            </Button>
          </form>
        </div>
      )}
    </Screen>
  );
}

/** Deep link from a request straight into its conversation. */
export function ChatForRequest(): JSX.Element {
  const { requestId = '' } = useParams();
  const navigate = useNavigate();
  const state = useAsync<{ conversationId: string }>(
    (signal) => api.get<{ conversationId: string }>(`/requests/${requestId}/conversation`, signal),
    [requestId],
  );

  useEffect(() => {
    if (state.data?.conversationId) navigate(`/chat/${state.data.conversationId}`, { replace: true });
  }, [state.data, navigate]);

  return (
    <Screen title="Chat" back>
      {state.error ? (
        <EmptyState
          emoji="💬"
          title="Chat is not open yet"
          message="A conversation opens once a helper has been selected for this request."
        />
      ) : (
        <div className="skeleton" style={{ height: 200 }} />
      )}
    </Screen>
  );
}
