# HA Scene Generator

Create Home Assistant light scenes by sampling colors from images. Select an area, choose your lights, pick a preset image or upload your own, then drag color sample points to create the perfect ambiance.

<img width="1410" height="972" alt="image" src="https://github.com/user-attachments/assets/3919c7ca-c07d-48e0-9486-b4e7a1200d91" />

## Features

- Connect to Home Assistant via Long-Lived Access Token
- Select lights by area (auto-filters to color-capable lights)
- 16 built-in preset images (nature, neon, abstract, etc.)
- Upload custom images or drag & drop
- Draggable color sample points
- Adjustable brightness slider
- Auto-activates scene on creation
- Clean, modern dark UI
- **Lightweight Docker deployment** (~50MB image, ~10MB RAM at idle)

## Setup

### Option 1: Docker (Recommended)

1. Clone the repo:
   ```bash
   git clone https://github.com/briankeefe/ha-scene-generator.git
   cd ha-scene-generator
   ```

2. Edit `nginx.conf` and update the Home Assistant IP:
   ```nginx
   # Change this line
   proxy_pass http://YOUR_HA_IP:8123/api/;
   ```

3. Build the app:
   ```bash
   cd app
   npm install
   npm run build
   cd ..
   ```

4. Start the container:
   ```bash
   docker-compose up -d
   ```

5. Open http://localhost:8090

### Option 2: Local Development

1. Clone the repo:
   ```bash
   git clone https://github.com/briankeefe/ha-scene-generator.git
   cd ha-scene-generator/app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the dev server:
   ```bash
   npm run dev
   ```

4. Open http://localhost:5173

**Note:** For local development, you'll need to configure a proxy to avoid CORS issues. The Vite dev server can be configured in `vite.config.ts`:

```typescript
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ha-api': {
        target: 'http://YOUR_HA_IP:8123',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ha-api/, '/api'),
      },
    },
  },
})
```

## Usage

1. Get a Long-Lived Access Token from Home Assistant:
   - Go to your HA Profile → Security → Long-Lived Access Tokens
   - Create a new token and copy it

2. Paste the token and connect

3. Select an area to load its color-capable lights

4. Choose a preset image or upload your own

5. Click "Randomize Samples" to place color points, or drag them manually

6. Adjust brightness if needed

7. Name your scene and click "Create Scene"

The scene will be created and immediately activated. Find it in Home Assistant under `scene.your_scene_name`.

## Tech Stack

- React + TypeScript
- Vite
- Nginx (Docker)
- Home Assistant REST API

## License

MIT
