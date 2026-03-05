# Proaktiver KI-Agent

Ein selbst-hostbarer, proaktiver persoenlicher KI-Agent, der dich aktiv kontaktiert, deine Ziele verfolgt und autonom im Hintergrund arbeitet.

## Features

- **Persistentes Gedaechtnis**: Merkt sich Informationen, Ziele und Commitments
- **Proaktive Push-Notifications**: Kontaktiert dich zu sinnvollen Zeitpunkten via ntfy.sh
- **Commitment-Tracking**: Erkennt Versprechen und erinnert bei Ueberfaelligkeit
- **Google Calendar Integration**: Zeigt heutige Termine, erstellt neue Events
- **Web-Monitoring**: Verfolgt Themen und sendet taegliche Zusammenfassungen
- **PWA Chat-Interface**: Mobile-optimiert, installierbar, Dark Mode

## Schnellstart (Lokal)

### 1. Abhaengigkeiten installieren

```bash
cd agent
pip install -r requirements.txt
```

### 2. Umgebungsvariablen konfigurieren

```bash
cp .env.example .env
```

Mindestens setzen:
- `ANTHROPIC_API_KEY`: Dein Anthropic API Key
- `NTFY_TOPIC`: Ein einzigartiger Topic-Name fuer Push-Notifications
- `AGENT_NAME`: Name deines Agenten (z.B. "Max")

### 3. Starten

```bash
python main.py
```

Oder mit uvicorn direkt:

```bash
uvicorn main:app --reload --port 8000
```

### 4. Oeffnen

Browser: `http://localhost:8000/static/index.html`

## Railway Deployment

### 1. Repository mit Railway verbinden

1. Neues Projekt auf [railway.app](https://railway.app) erstellen
2. GitHub Repository verbinden
3. **Root Directory** auf `agent` setzen (Settings > Root Directory)

### 2. Umgebungsvariablen setzen

In Railway Settings > Variables:

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API Key | `sk-ant-...` |
| `NTFY_TOPIC` | Einzigartiger ntfy Topic | `mein-agent-abc123` |
| `NTFY_URL` | ntfy Server URL | `https://ntfy.sh` |
| `AGENT_NAME` | Name des Agenten | `Max` |
| `DATABASE_URL` | SQLite Pfad | `sqlite:///./agent.db` |
| `GOOGLE_CALENDAR_CREDENTIALS` | Google Credentials JSON (optional) | `{"type":"service_account",...}` |
| `GOOGLE_CALENDAR_ID` | Calendar ID (optional) | `primary` |

### 3. Deploy

Railway erkennt das Procfile automatisch und startet den Server.

## ntfy.sh Konfiguration

### Oeffentlicher Server (einfachster Weg)

1. Waehle einen einzigartigen Topic-Namen (z.B. `mein-agent-zufallsstring-123`)
2. Setze `NTFY_URL=https://ntfy.sh` und `NTFY_TOPIC=dein-topic-name`
3. Installiere die ntfy App auf deinem Handy
4. Abonniere denselben Topic in der App

### Selbst-gehosteter Server

1. ntfy Server aufsetzen (siehe [ntfy Docs](https://docs.ntfy.sh/install/))
2. `NTFY_URL` auf deine Server-URL setzen

### Testen

```bash
curl -X POST http://localhost:8000/notify/test
```

## Google Calendar (Optional)

1. Google Cloud Console: Calendar API aktivieren
2. Service Account erstellen
3. JSON Credentials herunterladen
4. Kalender mit dem Service Account teilen
5. `GOOGLE_CALENDAR_CREDENTIALS` mit dem JSON-Inhalt setzen

Der Agent startet auch ohne Google Calendar Konfiguration.

## API Endpoints

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| POST | `/chat` | Nachricht senden, Antwort erhalten |
| GET | `/goals` | Alle Ziele abrufen |
| POST | `/goals` | Neues Ziel anlegen |
| PATCH | `/goals/{id}` | Ziel-Status aktualisieren |
| GET | `/commitments` | Alle Commitments mit Status |
| GET | `/memories` | Gespeicherte Erinnerungen |
| POST | `/notify/test` | Test-Push senden |
| GET | `/health` | Health Check |

## Scheduler

Automatische Checks:
- **07:30** Morgen-Check: Kalender + proaktive Nachricht
- **10:00** Monitor-Check: Web-Suche fuer aktive Themen
- **12:00** Mittags-Check: Commitments + Ziel-Fortschritt
- **19:00** Abend-Check: Ueberfaellige Commitments + Tagesreview

Rate-Limiting: Maximal 1 proaktive Notification alle 2 Stunden (Spam-Schutz).

## Tech Stack

- **Backend**: Python, FastAPI
- **Datenbank**: SQLite + SQLAlchemy
- **KI**: Anthropic Claude API (claude-sonnet-4-20250514)
- **Scheduler**: APScheduler
- **Push**: ntfy.sh
- **Kalender**: Google Calendar API
- **Frontend**: PWA (HTML/CSS/JS)
