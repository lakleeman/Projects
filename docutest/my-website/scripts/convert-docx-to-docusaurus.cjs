#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const {parse} = require('node-html-parser');

function printUsage() {
  console.log(`Usage: node scripts/convert-docx-to-docusaurus.cjs <input.docx> [options]\n\nOptions:\n  --output <dir>             Output docs directory (default: docs/generated/<basename>)\n  --static-output <dir>      Output static image directory (default: static/img/docx-conversions/<basename>)\n  --chapter-style <name>     Word paragraph style used for chapter headings\n  --article-style <name>     Word paragraph style used for article headings\n  --section-style <name>     Word paragraph style used for section headings\n  --title <title>            Override the generated document title`);
}

function parseArgs(argv) {
  const args = {_: []};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const [key, rawValue] = arg.split('=');
      const value = rawValue ?? argv[++i];
      if (!value) {
        throw new Error(`Missing value for ${key}`);
      }
      args[key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'document';
}

function escapeYaml(value) {
  return String(value).replace(/(["\\])/g, '\\$1');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, {recursive: true});
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function toText(node) {
  if (!node) {
    return '';
  }
  if (node.nodeType === 3) {
    return node.text;
  }
  if (node.tagName === 'br') {
    return '\n';
  }
  if (node.childNodes && node.childNodes.length > 0) {
    return node.childNodes.map(toText).join('');
  }
  return '';
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function makeInlineMarkdown(node, imagePublicPath) {
  if (!node) {
    return '';
  }
  if (node.nodeType === 3) {
    return normalizeWhitespace(node.text);
  }
  const tag = node.tagName && node.tagName.toLowerCase();
  if (!tag) {
    return '';
  }
  if (tag === 'br') {
    return '\n';
  }
  if (tag === 'img') {
    const src = node.getAttribute('src') || '';
    const alt = node.getAttribute('alt') || '';
    return `![${alt}](${src || imagePublicPath})`;
  }
  if (tag === 'strong' || tag === 'b') {
    return `**${node.childNodes.map((child) => makeInlineMarkdown(child, imagePublicPath)).join('')}**`;
  }
  if (tag === 'em' || tag === 'i') {
    return `*${node.childNodes.map((child) => makeInlineMarkdown(child, imagePublicPath)).join('')}*`;
  }
  if (tag === 'code') {
    return `\`${normalizeWhitespace(node.text)}\``;
  }
  if (tag === 'a') {
    const href = node.getAttribute('href') || '';
    const label = node.childNodes.map((child) => makeInlineMarkdown(child, imagePublicPath)).join('');
    return href ? `[${label}](${href})` : label;
  }
  if (tag === 'sup') {
    return `^${node.childNodes.map((child) => makeInlineMarkdown(child, imagePublicPath)).join('')}^`;
  }
  if (tag === 'sub') {
    return `~${node.childNodes.map((child) => makeInlineMarkdown(child, imagePublicPath)).join('')}~`;
  }
  return node.childNodes.map((child) => makeInlineMarkdown(child, imagePublicPath)).join('');
}

function toMarkdownBlock(node, imagePublicPath) {
  if (!node) {
    return '';
  }
  const tag = node.tagName && node.tagName.toLowerCase();
  if (!tag) {
    return '';
  }
  if (tag === 'p') {
    const text = normalizeWhitespace(node.childNodes.map((child) => makeInlineMarkdown(child, imagePublicPath)).join(''));
    return text ? `${text}\n` : '';
  }
  if (tag === 'ul') {
    return node.querySelectorAll('li').map((li) => `- ${normalizeWhitespace(li.childNodes.map((child) => makeInlineMarkdown(child, imagePublicPath)).join(''))}`).join('\n') + '\n';
  }
  if (tag === 'ol') {
    return node.querySelectorAll('li').map((li, index) => `${index + 1}. ${normalizeWhitespace(li.childNodes.map((child) => makeInlineMarkdown(child, imagePublicPath)).join(''))}`).join('\n') + '\n';
  }
  if (tag === 'img') {
    const src = node.getAttribute('src') || imagePublicPath || '';
    const alt = node.getAttribute('alt') || '';
    return `![${alt}](${src})\n`;
  }
  if (tag === 'table') {
    const rows = [];
    node.querySelectorAll('tr').forEach((tr) => {
      const cells = tr.querySelectorAll('th,td').map((cell) => normalizeWhitespace(cell.text));
      if (cells.length > 0) {
        rows.push(cells.join(' | '));
      }
    });
    if (rows.length === 0) {
      return '';
    }
    return `| ${rows[0]} |\n| --- |\n${rows.slice(1).map((row) => `| ${row} |`).join('\n')}\n`;
  }
  if (tag === 'blockquote') {
    return `> ${node.childNodes.map((child) => makeInlineMarkdown(child, imagePublicPath)).join('')}\n`;
  }
  const children = node.childNodes || [];
  const rendered = children.map((child) => toMarkdownBlock(child, imagePublicPath)).filter(Boolean).join('\n\n');
  return rendered ? `${rendered}\n` : '';
}

function buildStyleMap(chapterStyle, articleStyle, sectionStyle) {
  const mappings = [];
  if (chapterStyle) {
    mappings.push(`p[style-name='${chapterStyle}'] => h1:fresh`);
  }
  if (articleStyle) {
    mappings.push(`p[style-name='${articleStyle}'] => h2:fresh`);
  }
  if (sectionStyle) {
    mappings.push(`p[style-name='${sectionStyle}'] => h3:fresh`);
  }
  return mappings;
}

function inferExtension(contentType) {
  if (contentType.includes('png')) {
    return 'png';
  }
  if (contentType.includes('jpeg') || contentType.includes('jpg')) {
    return 'jpg';
  }
  if (contentType.includes('gif')) {
    return 'gif';
  }
  if (contentType.includes('webp')) {
    return 'webp';
  }
  if (contentType.includes('svg')) {
    return 'svg';
  }
  return 'png';
}

function getTagName(node) {
  return node && node.tagName ? node.tagName.toLowerCase() : '';
}

function isBlockTag(node) {
  const tag = getTagName(node);
  return ['p', 'ul', 'ol', 'img', 'table', 'blockquote'].includes(tag);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  const inputArg = args._[0];
  if (!inputArg) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const inputPath = path.resolve(process.cwd(), inputArg);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input document not found: ${inputPath}`);
  }

  const docName = path.basename(inputPath, path.extname(inputPath));
  const outputRoot = path.resolve(process.cwd(), args.output || path.join('docs', 'generated', slugify(docName)));
  const staticRoot = path.resolve(process.cwd(), args.staticOutput || path.join('static', 'img', 'docx-conversions', slugify(docName)));
  const docsRoot = path.resolve(process.cwd(), 'docs');
  const routeBase = path.relative(docsRoot, outputRoot).replace(/\\/g, '/');
  const publicImageRoot = `/img/docx-conversions/${slugify(docName)}`;

  const titleOverride = args.title || docName;
  const styleMap = buildStyleMap(args.chapterStyle, args.articleStyle, args.sectionStyle);

  ensureDir(outputRoot);
  ensureDir(staticRoot);

  const imageCounter = {value: 0};
  const imageConverter = mammoth.images.imgElement(function(image) {
    return image.read().then(function(buffer) {
      const contentType = image.contentType || 'image/png';
      const ext = inferExtension(contentType);
      const imageName = `image-${++imageCounter.value}.${ext}`;
      const imagePath = path.join(staticRoot, imageName);
      fs.writeFileSync(imagePath, buffer);
      return {src: `${publicImageRoot}/${imageName}`};
    });
  });

  const result = await mammoth.convertToHtml({path: inputPath}, {
    styleMap: styleMap.length > 0 ? styleMap : undefined,
    convertImage: imageConverter,
  });

  const root = parse(result.value);
  const chapters = [];
  let currentChapter = null;
  let currentArticle = null;

  function ensureChapter(title) {
    if (!currentChapter) {
      currentChapter = {title, introBlocks: [], articles: []};
      chapters.push(currentChapter);
    }
    return currentChapter;
  }

  function ensureArticle(title) {
    if (!currentArticle) {
      const chapter = ensureChapter('Introduction');
      currentArticle = {title, blocks: []};
      chapter.articles.push(currentArticle);
    }
    return currentArticle;
  }

  const documentNodes = [];
  root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,ul,ol,table,blockquote,img').forEach((node) => {
    documentNodes.push(node);
  });

  documentNodes.forEach((node) => {
    const tag = getTagName(node);
    if (tag.startsWith('h')) {
      const level = Number(tag.replace('h', ''));
      const title = normalizeWhitespace(node.text);
      if (level === 1) {
        currentChapter = {title, introBlocks: [], articles: []};
        chapters.push(currentChapter);
        currentArticle = null;
      } else if (level === 2) {
        ensureChapter('Introduction');
        currentArticle = {title, blocks: []};
        currentChapter.articles.push(currentArticle);
      } else if (level === 3) {
        ensureChapter('Introduction');
        if (!currentArticle) {
          currentArticle = {title: 'Untitled Article', blocks: []};
          currentChapter.articles.push(currentArticle);
        }
        currentArticle.blocks.push({type: 'heading', level: 2, title});
      } else {
        ensureArticle('Untitled Article');
        currentArticle.blocks.push({type: 'heading', level: level + 1, title});
      }
      return;
    }

    if (isBlockTag(node)) {
      const rendered = toMarkdownBlock(node, null);
      const blockContent = rendered ? rendered.trim() : '';
      if (!blockContent) {
        return;
      }
      if (currentArticle) {
        currentArticle.blocks.push({type: 'content', content: blockContent});
      } else if (currentChapter) {
        currentChapter.introBlocks.push({type: 'content', content: blockContent});
      } else {
        currentChapter = {title: titleOverride, introBlocks: [], articles: []};
        chapters.push(currentChapter);
        currentChapter.introBlocks.push({type: 'content', content: blockContent});
      }
    }
  });

  if (chapters.length === 0) {
    chapters.push({title: titleOverride, introBlocks: [], articles: []});
  }

  const slugBase = slugify(docName);
  const usedSlugs = new Set();

  function uniqueSlug(base) {
    const normalizedBase = slugify(base) || 'section';
    let candidate = normalizedBase;
    let index = 2;
    while (usedSlugs.has(candidate)) {
      candidate = `${normalizedBase}-${index}`;
      index += 1;
    }
    usedSlugs.add(candidate);
    return candidate;
  }

  chapters.forEach((chapter, chapterIndex) => {
    const chapterSlug = uniqueSlug(chapter.title || titleOverride || 'chapter');
    chapter.slug = chapterSlug;
    const chapterFilePath = path.join(outputRoot, chapterSlug, 'index.mdx');
    const chapterLines = [];
    chapterLines.push('---');
    chapterLines.push(`title: ${escapeYaml(chapter.title || titleOverride)}`);
    chapterLines.push(`sidebar_position: ${chapterIndex + 1}`);
    chapterLines.push('---');
    chapterLines.push('');
    chapter.introBlocks.forEach((block) => {
      if (block.type === 'content') {
        chapterLines.push(block.content);
        chapterLines.push('');
      }
    });
    if (chapter.articles.length > 0) {
      chapterLines.push('## Articles');
      chapterLines.push('');
      chapter.articles.forEach((article, articleIndex) => {
        article.slug = uniqueSlug(article.title || `article-${articleIndex + 1}`);
        chapterLines.push(`- [${escapeYaml(article.title || `Article ${articleIndex + 1}`)}](/docs/current/${routeBase}/${chapterSlug}/${article.slug})`);
      });
    }
    writeFile(chapterFilePath, chapterLines.join('\n').trim() + '\n');

    chapter.articles.forEach((article, articleIndex) => {
      const articleSlug = article.slug || uniqueSlug(article.title || `article-${articleIndex + 1}`);
      const articleFilePath = path.join(outputRoot, chapterSlug, articleSlug, 'index.mdx');
      const articleLines = [];
      articleLines.push('---');
      articleLines.push(`title: ${escapeYaml(article.title || `Article ${articleIndex + 1}`)}`);
      articleLines.push(`sidebar_position: ${articleIndex + 1}`);
      articleLines.push('---');
      articleLines.push('');
      article.blocks.forEach((block) => {
        if (block.type === 'heading') {
          const hashes = '#'.repeat(Math.min(block.level, 6));
          articleLines.push(`${hashes} ${block.title}`);
          articleLines.push('');
        } else if (block.type === 'content') {
          articleLines.push(block.content);
          articleLines.push('');
        }
      });
      writeFile(articleFilePath, articleLines.join('\n').trim() + '\n');
    });
  });

  console.log(`Converted ${path.basename(inputPath)} to ${outputRoot}`);
  console.log(`Images written to ${staticRoot}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
