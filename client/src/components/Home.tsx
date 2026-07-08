import { useState, type FormEvent } from 'react';
import { socket } from '../socket';

interface Props {
  /** Room code parsed from a shared /room/CODE link, if any. */
  urlCode: string | null;
  onJoined: (code: string) => void;
  onError: (message: string) => void;
}

export function Home({ urlCode, onJoined, onError }: Props) {
  const [name, setName] = useState('');
  const [code, setCode] = useState(urlCode ?? '');
  const [busy, setBusy] = useState(false);

  const create = () => {
    if (!name.trim()) return onError('Pick a name first');
    setBusy(true);
    socket.emit('room:create', { name }, (res) => {
      setBusy(false);
      if (res.ok) onJoined(res.code);
      else onError(res.error);
    });
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return onError('Pick a name first');
    if (!code.trim()) return onError('Enter a room code');
    setBusy(true);
    socket.emit('room:join', { code: code.trim().toUpperCase(), name }, (res) => {
      setBusy(false);
      if (res.ok) onJoined(code.trim().toUpperCase());
      else onError(res.error);
    });
  };

  return (
    <main className="home">
      <p className="tagline">
        Paint-to-camouflage hide &amp; seek. Hiders paint their own body to melt into the
        scenery; seekers hunt them down. Straight from the browser — no downloads, no sign-up.
      </p>
      <label>
        Your name
        <input
          value={name}
          maxLength={20}
          placeholder="e.g. Fede"
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </label>

      {urlCode ? (
        <form onSubmit={join} className="entry">
          <p>You've been invited to room <strong>{urlCode}</strong>!</p>
          <button type="submit" disabled={busy}>Join room {urlCode}</button>
        </form>
      ) : (
        <>
          <div className="entry">
            <button onClick={create} disabled={busy}>Create a room</button>
          </div>
          <div className="divider">or join a friend's room</div>
          <form onSubmit={join} className="entry entry-row">
            <input
              value={code}
              maxLength={8}
              placeholder="Room code"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button type="submit" disabled={busy}>Join</button>
          </form>
        </>
      )}
    </main>
  );
}
