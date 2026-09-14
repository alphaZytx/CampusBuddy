import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../lib/api';
import { useAsync } from '../lib/useAsync';

interface CampusData {
  campus: {
    id: string;
    name: string;
    city: string;
    centre_lat: number;
    centre_lng: number;
    geofence_radius_metres: number;
    email_domains: string[];
    institution_name: string;
  };
  departments: { id: string; code: string; name: string }[];
  hostels: { id: string; name: string }[];
}

/**
 * Campus configuration (spec §59).
 *
 * The geofence in particular is editable here because the coordinates shipped in
 * `.env` are approximate — an administrator standing on campus can read their real
 * position off a phone and correct it without a redeploy.
 */
export function CampusSettings({ canEdit }: { canEdit: boolean }): JSX.Element {
  const state = useAsync<CampusData>((signal) => api.get<CampusData>('/admin/campus', signal), []);
  const [form, setForm] = useState({ lat: '', lng: '', radius: '', city: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!state.data) return;
    setForm({
      lat: String(state.data.campus.centre_lat),
      lng: String(state.data.campus.centre_lng),
      radius: String(state.data.campus.geofence_radius_metres),
      city: state.data.campus.city,
    });
  }, [state.data]);

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    const lat = Number(form.lat);
    const lng = Number(form.lng);
    const radius = Number(form.radius);
    // Checked here because an empty box would otherwise become 0 and quietly move the
    // campus to 0°N 0°E, after which every location verification would fail.
    if (form.lat.trim() === '' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      setMessage('Enter a centre latitude between -90 and 90.');
      return;
    }
    if (form.lng.trim() === '' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      setMessage('Enter a centre longitude between -180 and 180.');
      return;
    }
    if (!Number.isInteger(radius) || radius < 50 || radius > 50_000) {
      setMessage('Enter a whole-number radius between 50 and 50,000 metres.');
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      await api.patch('/admin/campus', {
        centreLat: lat,
        centreLng: lng,
        geofenceRadiusMetres: radius,
        city: form.city.trim() || undefined,
      });
      setMessage(
        'Campus settings saved. Location verification uses these values from now on, including after the server restarts.',
      );
      state.reload();
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  if (state.loading && !state.data) return <div className="skeleton" style={{ height: 300 }} />;
  if (!state.data) return <div className="alert alert--error">{state.error ?? 'Could not load.'}</div>;

  return (
    <>
      <div className="admin-header">
        <div>
          <h1>Campus</h1>
          <p className="muted mt-2">
            {state.data.campus.institution_name} · {state.data.campus.name}
          </p>
        </div>
      </div>

      {message && <div className="alert alert--info mb-4">{message}</div>}

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <form className="card" onSubmit={save}>
          <h2>Verification geofence</h2>
          <p className="small muted mt-2 mb-4">
            A student verifying by location must be within this radius of the centre point. Stand
            on campus, read your coordinates from any maps app, and enter them here.
          </p>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="lat">Centre latitude</label>
              <input
                id="lat"
                className="input"
                value={form.lat}
                onChange={(event) => setForm({ ...form, lat: event.target.value })}
                disabled={!canEdit}
              />
            </div>
            <div className="field">
              <label htmlFor="lng">Centre longitude</label>
              <input
                id="lng"
                className="input"
                value={form.lng}
                onChange={(event) => setForm({ ...form, lng: event.target.value })}
                disabled={!canEdit}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="radius">Radius (metres)</label>
            <input
              id="radius"
              className="input"
              inputMode="numeric"
              value={form.radius}
              onChange={(event) => setForm({ ...form, radius: event.target.value })}
              disabled={!canEdit}
            />
            <div className="hint">Between 50 and 50,000 metres.</div>
          </div>

          <div className="field">
            <label htmlFor="city">City</label>
            <input
              id="city"
              className="input"
              value={form.city}
              onChange={(event) => setForm({ ...form, city: event.target.value })}
              disabled={!canEdit}
            />
          </div>

          {canEdit ? (
            <button type="submit" className="btn btn--block" disabled={busy}>
              {busy && <span className="spinner" />} Save
            </button>
          ) : (
            <div className="alert alert--info">Only an administrator can change these.</div>
          )}
        </form>

        <div className="stack">
          <div className="card">
            <h2>Permitted email domains</h2>
            <p className="small muted mt-2 mb-3">
              Set in the server environment file. Only these domains can register.
            </p>
            <div className="row row--wrap" style={{ gap: 'var(--sp-2)' }}>
              {state.data.campus.email_domains.map((domain) => (
                <span key={domain} className="chip chip--static">
                  @{domain}
                </span>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>Departments</h2>
            <div className="row row--wrap mt-3" style={{ gap: 'var(--sp-2)' }}>
              {state.data.departments.map((department) => (
                <span key={department.id} className="chip chip--static" title={department.name}>
                  {department.code}
                </span>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>Hostels</h2>
            <div className="row row--wrap mt-3" style={{ gap: 'var(--sp-2)' }}>
              {state.data.hostels.map((hostel) => (
                <span key={hostel.id} className="chip chip--static">
                  {hostel.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
