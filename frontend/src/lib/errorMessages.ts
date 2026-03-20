const ERROR_MAP: Record<string, string> = {
  'Host not online': 'Host ist nicht erreichbar',
  'No IP address': 'Keine IP-Adresse konfiguriert',
  'ECONNREFUSED': 'Verbindung abgelehnt',
  'ECONNRESET': 'Verbindung unterbrochen',
  'ETIMEDOUT': 'Zeitueberschreitung',
  'EHOSTUNREACH': 'Host nicht erreichbar',
  'channel open failure': 'SSH-Kanal konnte nicht geoeffnet werden',
  'All configured authentication methods failed': 'SSH-Authentifizierung fehlgeschlagen',
  'Timed out while waiting': 'Zeitueberschreitung beim Warten',
  'No response from host': 'Keine Antwort vom Host',
};

export function translateError(raw: string): string {
  for (const [pattern, translation] of Object.entries(ERROR_MAP)) {
    if (raw.includes(pattern)) return translation;
  }
  const exitMatch = raw.match(/Exit code (\d+)/);
  if (exitMatch) return `Befehl fehlgeschlagen (Exit-Code ${exitMatch[1]})`;
  return raw; // fallback: show raw if no translation
}
