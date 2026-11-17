# Local setup

Rogue Agent Control runs locally with Node.js, SQLite and an optional local model. The guided synthetic scenarios need no account, API key or model download. Product research with the shopping agent needs Ollama and `qwen3:4b`. Live product discovery additionally needs a Channel3 key.

## Requirements

- Node.js 20.9–20.x, 22.x or 24.x and npm. The current project was verified on Windows with Node 20.20.1 and npm 11.5.2. Other platforms may need native build tools if `better-sqlite3` has no prebuilt binary.
- A browser with JavaScript enabled. Automated browser checks use Chromium.
- Internet access for the initial `npm ci` and model download. The synthetic demo makes no external API calls while running.

From the repository directory:

```powershell
npm ci
npm run dev
```

Open `http://127.0.0.1:3000/demo`. Choose **Synthetic Policy Violation** or **Practice Quantity Controls**. Their labels and evidence make clear that they are fixtures, not actual model or catalog activity. The two archived genuine scenarios require the owner's separate private SQLite recordings; a clean checkout reports them as unavailable.

To use a different port, run `npm run dev -- --port 3100` and open the matching loopback URL. For a production build, stop the development server, run `npm run build`, then `npm start`.

## Local Qwen3 shopping agent

1. [Install Ollama](https://ollama.com/download) for your operating system. Keep its local service available on `http://127.0.0.1:11434`.
2. Download the [Qwen3 4B model](https://ollama.com/library/qwen3%3A4b):

   ```powershell
   ollama pull qwen3:4b
   ollama list
   ```

3. If `.env.local` does not already exist, create it from the placeholders: `Copy-Item .env.example .env.local`. Keep `LLM_PROVIDER=ollama`, `OLLAMA_MODEL=qwen3:4b` and `OLLAMA_BASE_URL=http://localhost:11434`. Restart the app after changing environment values.
4. Open `/shopping`, choose the **Offline** catalog and submit a mandate. Offline means seeded products, while the model's search and recommendation are actual local Qwen3 calls. Inspect the resulting run in Black Box. If the model is missing or unavailable, the app reports a failure; it does not invent a successful model run.

The server accepts only a loopback Ollama URL and the exact `qwen3:4b` model. Model downloads and generation time vary by hardware. No cloud model or paid LLM account is required.

## Optional Channel3 product search

1. Obtain an API key through [Channel3's developer page](https://channel3.ai/developers) and dashboard. Consult its [current API documentation](https://channel3.ai/docs) for access and account details.
2. Add `CHANNEL3_API_KEY=your-own-key` to your local `.env.local`. Keep the key server-side: never use a `NEXT_PUBLIC_` prefix, paste it into a shopping objective, put it in a URL, or commit it. Restart the server.
3. In `/shopping`, select **Channel3 Live** and run a new mandate. The app calls Channel3's search API. An unavailable service, invalid key or unusable response is reported explicitly; it is never silently replaced with seeded products.

Channel3 is optional. The Offline catalog remains usable without a key. Product listings and merchant names from a catalog are unverified external claims, not purchasing authorization.

## Configuration and data

| Setting | Purpose | Needed for |
| --- | --- | --- |
| `DATABASE_PATH` | Local SQLite path; default `./data/rogue-control.sqlite` | Persisting your own runs |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Local model endpoint and exact model name | Actual model shopping and new AI reports |
| `CHANNEL3_API_KEY` | Server-only product discovery key | Optional live catalog search |

The application creates local SQLite state on first use. `.env.local`, `data/`, build output and browser test artifacts are ignored by the repository. Do not add credentials or private recordings to a public commit. Preserve an existing `.env.local` and `data/` directory when updating the source.

## Verify a checkout

```powershell
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Tests use isolated fixtures and mocked external responses. A passing test suite does not prove that your local model or optional catalog key is configured. Check `/shopping` integration status and perform a separate local run to verify those connections. The guided demo and deterministic policy evaluation remain available when optional integrations are absent.
