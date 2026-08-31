import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// PENTING: ganti 'NAMA_REPO_ANDA' di bawah dengan nama repository GitHub Anda persis
// (contoh: kalau repo-nya github.com/USER/papan-kegiatan, tulis '/papan-kegiatan/')
export default defineConfig({
  plugins: [react()],
  base: '/skedul/',
})
