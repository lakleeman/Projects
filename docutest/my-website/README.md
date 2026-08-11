# Website

This website is built using [Docusaurus](https://docusaurus.io/), a modern static website generator.

## Installation

```bash
npm install
```

**Note**: feel free to use the package manager of your choice.

## Local Development

```bash
npm run start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

## Build

```bash
npm run build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.

## Converting a Word document to Docusaurus docs

You can convert a Word `.docx` file into a Docusaurus docs tree with chapter/article/section structure:

```bash
npm run convert:docx -- path/to/document.docx
```

The converter writes docs into `docs/generated/<document-name>/` and images into `static/img/docx-conversions/<document-name>/`.

If your document uses custom Word styles rather than the built-in `Heading 1/2/3` styles, pass them explicitly:

```bash
npm run convert:docx -- path/to/document.docx --chapter-style "Chapter" --article-style "Article" --section-style "Section"
```

## Deployment

Using SSH:

```bash
USE_SSH=true npm run deploy
```

Not using SSH:

```bash
GIT_USER=<Your GitHub username> npm run deploy
```

If you are using GitHub Pages for hosting, this command is a convenient way to build the website and push to the `gh-pages` branch.
