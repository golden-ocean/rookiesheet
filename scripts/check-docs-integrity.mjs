import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const DOCS_ROOT = path.resolve("src/content/docs")
const LOCALES = ["zh-cn", "en"]

const errors = []
const warnings = []

async function walk(dir) {
  const results = []
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      results.push(...(await walk(fullPath)))
    } else {
      results.push(fullPath)
    }
  }

  return results
}

function relativeId(filePath) {
  return path
    .relative(DOCS_ROOT, filePath)
    .replaceAll(path.sep, "/")
    .replace(/\.mdx?$/, "")
}

function isDraft(source) {
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)

  if (!match) return false

  return /^draft:\s*true\s*(?:#.*)?$/m.test(match[1])
}

function visitNavigation(node, context, result) {
  if (!node || typeof node !== "object") return

  if (node.type === "article") {
    if (!node.href) {
      errors.push(`[导航缺少 href] ${context}: "${node.title ?? "未命名文章"}"`)
    } else {
      const match = node.href.match(/^\/([^/]+)\/docs\/([^/]+)\/(.+)$/)

      if (!match) {
        errors.push(`[导航 href 格式错误] ${context}: ${node.href}`)
      } else {
        const [, locale, stack, slug] = match
        const id = `${locale}/${stack}/${slug}`

        if (!result.published.has(id)) {
          errors.push(`[导航目标不存在或未发布] ${context}: ${node.href}`)
        } else {
          result.navigated.add(id)
        }

        if (!LOCALES.includes(locale)) {
          errors.push(`[未知语言前缀] ${context}: ${node.href}`)
        }
      }
    }
  }

  if (Array.isArray(node.items)) {
    for (const child of node.items) {
      visitNavigation(child, context, result)
    }
  }
}

async function main() {
  const files = await walk(DOCS_ROOT)
  const mdxFiles = files.filter((file) => /\.mdx?$/.test(file))
  const metaFiles = files.filter((file) => path.basename(file) === "_meta.json")

  const result = {
    published: new Set(),
    all: new Set(),
    navigated: new Set(),
  }

  const sourceById = new Map()

  for (const file of mdxFiles) {
    const id = relativeId(file)
    const source = await readFile(file, "utf8")

    result.all.add(id)
    sourceById.set(id, source)

    if (!isDraft(source)) {
      result.published.add(id)
    }
  }

  for (const file of metaFiles) {
    const id = relativeId(file)
    const [locale, stack] = id.split("/")

    if (!locale || !stack || !LOCALES.includes(locale)) {
      errors.push(`[导航文件路径异常] ${id}`)
      continue
    }

    let meta

    try {
      meta = JSON.parse(await readFile(file, "utf8"))
    } catch (error) {
      errors.push(`[JSON 解析失败] ${id}: ${error.message}`)
      continue
    }

    visitNavigation(meta, id, result)
  }

  // 检查文档是否被导航覆盖
  for (const id of result.published) {
    if (!result.navigated.has(id)) {
      warnings.push(`[孤立文档] ${id}`)
    }
  }

  // 检查中英文配对
  for (const id of result.published) {
    const [locale, ...rest] = id.split("/")
    if (!LOCALES.includes(locale)) continue

    const otherLocale = locale === "zh-cn" ? "en" : "zh-cn"
    const counterpart = [otherLocale, ...rest].join("/")

    if (!result.published.has(counterpart)) {
      warnings.push(`[缺少对应语言文档] ${id} -> ${counterpart}`)
    }
  }

  for (const message of warnings) {
    console.warn(`⚠ ${message}`)
  }

  for (const message of errors) {
    console.error(`✗ ${message}`)
  }

  if (errors.length > 0) {
    console.error(
      `\n文档完整性检查失败：${errors.length} 个错误，${warnings.length} 个警告。`
    )
    process.exitCode = 1
    return
  }

  console.log(
    `文档完整性检查通过：${result.published.size} 篇已发布文档，${warnings.length} 个警告。`
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
