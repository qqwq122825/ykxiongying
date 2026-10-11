import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const distDir = path.resolve(__dirname, 'dist')
const publicDir = path.resolve(__dirname, '..', 'public')

function rimraf(dir) {
  if (!fs.existsSync(dir)) return
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      rimraf(full)
      fs.rmdirSync(full)
    } else {
      fs.unlinkSync(full)
    }
  }
}

function copyDir(src, dst) {
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isDirectory()) {
      copyDir(s, d)
    } else {
      fs.copyFileSync(s, d)
    }
  }
}

function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[FATAL] dist/ 目录不存在，请先执行 vite build')
    console.error('  用法: npm run build （会先 build，再把 dist 复制到 public）\n')
    process.exit(1)
  }
  console.log('>>> 清理 public/assets ...')
  const assetsDir = path.join(publicDir, 'assets')
  rimraf(assetsDir)
  console.log('>>> 复制 dist -> public ...')
  copyDir(distDir, publicDir)
  console.log('>>> 完成！')
}

main()
