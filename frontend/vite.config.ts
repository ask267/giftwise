import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `npm run dev` serves the app on http://localhost:5190; it calls the backend on :8020.
export default defineConfig({
  plugins: [react()],
  server: { host: 'localhost', port: 5190, strictPort: true },
})
