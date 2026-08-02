import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import vitePrerender from 'vite-plugin-prerender'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    vitePrerender({
      // 완성된 사이트가 담길 폴더 위치를 알려줍니다.
      staticDir: path.join(__dirname, 'dist'),
      // 네이버 로봇이 방문해서 미리 사진을 찍어둘 넷플픽의 방(주소) 목록입니다.
      routes: [
        '/', 
        '/latest-reviews', 
        '/cinema-hell', 
        '/my-ratings', 
        '/my-taste'
      ],
    })
  ],
})