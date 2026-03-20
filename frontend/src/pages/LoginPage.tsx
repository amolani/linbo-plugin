import { useState, FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Monitor } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button, Input } from '@/components/ui';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading, error, clearError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();

    try {
      await login(username, password);
      navigate(from, { replace: true });
    } catch {
      // Error is handled in the store
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-primary flex items-center justify-center">
            <Monitor className="h-9 w-9 text-primary-foreground" />
          </div>
          <h2 className="mt-6 text-3xl font-extrabold text-foreground">LINBO Docker</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Standalone Network Boot & Imaging Solution
          </p>
        </div>

        <div className="bg-card border border-border rounded-lg shadow-xl p-8">
          <form className="space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-md text-sm">
                {error}
              </div>
            )}

            <Input
              label="Benutzername"
              name="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
            />

            <Input
              label="Passwort"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />

            <Button type="submit" fullWidth loading={isLoading}>
              Anmelden
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          Standard-Zugangsdaten: admin / admin
        </p>
      </div>
    </div>
  );
}
