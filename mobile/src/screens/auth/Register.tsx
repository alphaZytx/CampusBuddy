import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { registerSchema } from '@campusbuddy/shared';
import { ApiError, api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { useAuth } from '../../state/auth';
import { Alert, Button, Field, Input } from '../../components/ui';

interface CampusInfo {
  campus: { name: string; institutionShortName: string; emailDomains: string[] };
  departments: { id: string; code: string; name: string }[];
  hostels: { id: string; name: string }[];
}

export function Register(): JSX.Element {
  const { register } = useAuth();
  const navigate = useNavigate();
  const { data } = useAsync<CampusInfo>(() => api.get<CampusInfo>('/campus'), []);

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    phone: '',
    departmentId: '',
    hostelId: '',
    yearOfStudy: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const payload = {
      fullName: form.fullName.trim(),
      email: form.email.trim().toLowerCase(),
      password: form.password,
      ...(form.phone ? { phone: form.phone } : {}),
      ...(form.departmentId ? { departmentId: form.departmentId } : {}),
      ...(form.hostelId ? { hostelId: form.hostelId } : {}),
      ...(form.yearOfStudy ? { yearOfStudy: Number(form.yearOfStudy) } : {}),
    };

    // The same schema the server uses, so the two can never disagree.
    const parsed = registerSchema.safeParse(payload);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.');
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setBusy(true);
    try {
      await register(parsed.data);
      navigate('/verify', { replace: true });
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
        setFieldErrors(cause.fieldErrors);
      } else {
        setError('Could not create your account. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  const domains = data?.campus.emailDomains.map((d) => `@${d}`).join(' or ') ?? '';

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/welcome" className="btn btn--ghost btn--sm" style={{ marginLeft: -8 }} aria-label="Back">
          ←
        </Link>
        <h1>Create account</h1>
      </header>
      <main className="app-main">
        {data && (
          <div className="mb-4">
            <Alert tone="info" title={`${data.campus.institutionShortName} · ${data.campus.name}`}>
              CampusBuddy is only for students of this campus. Register with your college
              email {domains && <>({domains})</>}.
            </Alert>
          </div>
        )}

        <form onSubmit={onSubmit} noValidate>
          {error && (
            <div className="mb-4">
              <Alert tone="error">{error}</Alert>
            </div>
          )}

          <Field label="Full name" id="fullName" error={fieldErrors.fullName}>
            <Input
              id="fullName"
              autoComplete="name"
              value={form.fullName}
              onChange={(event) => set('fullName')(event.target.value)}
              error={Boolean(fieldErrors.fullName)}
              required
            />
          </Field>

          <Field label="College email" id="email" error={fieldErrors.email}>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="name.ug22.cs@nitp.ac.in"
              value={form.email}
              onChange={(event) => set('email')(event.target.value)}
              error={Boolean(fieldErrors.email)}
              required
            />
          </Field>

          <Field
            label="Password"
            id="password"
            hint="At least 10 characters, with an upper and lower case letter and a number."
            error={fieldErrors.password}
          >
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => set('password')(event.target.value)}
              error={Boolean(fieldErrors.password)}
              required
            />
          </Field>

          <Field label="Phone (optional)" id="phone" error={fieldErrors.phone}>
            <Input
              id="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="10-digit mobile number"
              value={form.phone}
              onChange={(event) => set('phone')(event.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
              error={Boolean(fieldErrors.phone)}
            />
          </Field>

          <div className="grid-2">
            <Field label="Department" id="department">
              <select
                id="department"
                className="select"
                value={form.departmentId}
                onChange={(event) => set('departmentId')(event.target.value)}
              >
                <option value="">Select</option>
                {data?.departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.code}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Year" id="year">
              <select
                id="year"
                className="select"
                value={form.yearOfStudy}
                onChange={(event) => set('yearOfStudy')(event.target.value)}
              >
                <option value="">Select</option>
                {[1, 2, 3, 4, 5].map((year) => (
                  <option key={year} value={year}>
                    Year {year}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Hostel (optional)" id="hostel">
            <select
              id="hostel"
              className="select"
              value={form.hostelId}
              onChange={(event) => set('hostelId')(event.target.value)}
            >
              <option value="">Select</option>
              {data?.hostels.map((hostel) => (
                <option key={hostel.id} value={hostel.id}>
                  {hostel.name}
                </option>
              ))}
            </select>
          </Field>

          <Button type="submit" size="lg" block loading={busy}>
            Create account
          </Button>
        </form>

        <p className="center small muted mt-4">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </main>
    </div>
  );
}
