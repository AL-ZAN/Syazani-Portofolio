// api/save-post.js
// Serverless function: simpan/hapus artikel ke GitHub

const GITHUB_API = 'https://api.github.com';

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

function buildMarkdown(post) {
  return `---
title: ${post.title}
date: ${post.date}
excerpt: ${(post.excerpt || '').replace(/\n/g, ' ')}
author: ${post.author || 'Syazani'}
---

${post.content}
`;
}

async function ghRequest(path, opts = {}) {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_REPO_OWNER;
  const repo = process.env.GITHUB_REPO_NAME;

  if (!token || !owner || !repo) {
    throw new Error('Environment variable GITHUB_TOKEN / GITHUB_REPO_OWNER / GITHUB_REPO_NAME belum diset di Vercel');
  }

  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'syazani-portfolio-admin',
      ...(opts.headers || {})
    }
  });

  return res;
}

module.exports = async (req, res) => {
  // CORS sederhana
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const { password, slug, title, excerpt, content, date, author } = body;

    // Validasi password
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'syazani2026';
    if (!password || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Password salah' });
    }

    const cleanSlug = slugify(slug || title);
    if (!cleanSlug) {
      return res.status(400).json({ error: 'Slug kosong. Isi judul yang valid.' });
    }

    const filePath = `posts/${cleanSlug}.md`;

    // === HAPUS ===
    if (req.method === 'DELETE') {
      // Cek file ada dulu (perlu sha untuk delete)
      const getRes = await ghRequest(filePath, { method: 'GET' });
      if (getRes.status === 404) {
        return res.status(404).json({ error: 'Artikel tidak ditemukan' });
      }
      if (!getRes.ok) {
        const e = await getRes.json();
        return res.status(500).json({ error: 'Gagal cek file: ' + (e.message || 'unknown') });
      }
      const fileData = await getRes.json();

      // Hapus file
      const delRes = await ghRequest(filePath, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Hapus artikel: ${cleanSlug}`,
          sha: fileData.sha,
          branch: process.env.GITHUB_BRANCH || 'main'
        })
      });

      if (!delRes.ok) {
        const e = await delRes.json();
        return res.status(500).json({ error: 'Gagal hapus: ' + (e.message || 'unknown') });
      }

      await updatePostsJson('delete', cleanSlug);

      return res.status(200).json({ success: true, action: 'delete', slug: cleanSlug });
    }

    // === SIMPAN / UPDATE ===
    if (!title || !content) {
      return res.status(400).json({ error: 'Judul dan isi wajib diisi' });
    }

    const markdown = buildMarkdown({ title, excerpt, content, date, author });

    // Cek apakah file sudah ada (untuk update perlu sha)
    let sha = null;
    const getRes = await ghRequest(filePath, { method: 'GET' });
    if (getRes.ok) {
      const fileData = await getRes.json();
      sha = fileData.sha;
    }

    const putRes = await ghRequest(filePath, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `${sha ? 'Update' : 'Tambah'} artikel: ${title}`,
        content: Buffer.from(markdown, 'utf8').toString('base64'),
        branch: process.env.GITHUB_BRANCH || 'main',
        ...(sha ? { sha } : {})
      })
    });

    if (!putRes.ok) {
      const e = await putRes.json();
      return res.status(500).json({ error: 'Gagal simpan: ' + (e.message || 'unknown') });
    }

    await updatePostsJson('save', cleanSlug, { title, excerpt, date, author });

    return res.status(200).json({ success: true, action: 'save', slug: cleanSlug });
  } catch (err) {
    console.error('save-post error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
};

/* Update posts.json agar daftar artikel di index.html selalu sinkron */
async function updatePostsJson(action, slug, meta) {
  const postsPath = 'posts.json';
  let posts = [];
  let sha = null;

  const getRes = await ghRequest(postsPath, { method: 'GET' });
  if (getRes.ok) {
    const data = await getRes.json();
    sha = data.sha;
    try {
      const content = Buffer.from(data.content, 'base64').toString('utf8');
      posts = JSON.parse(content);
      if (!Array.isArray(posts)) posts = [];
    } catch (e) { posts = []; }
  }

  if (action === 'delete') {
    posts = posts.filter(p => p.slug !== slug);
  } else {
    // Ambil konten penuh untuk disimpan di posts.json
    const fileRes = await ghRequest(`posts/${slug}.md`, { method: 'GET' });
    let fullContent = '';
    if (fileRes.ok) {
      const fileData = await fileRes.json();
      const md = Buffer.from(fileData.content, 'base64').toString('utf8');
      const match = md.match(/^---[\s\S]*?---\s*\n([\s\S]*)$/);
      fullContent = match ? match[1].trim() : md;
    }

    const newPost = {
      slug,
      title: meta.title,
      date: meta.date,
      excerpt: meta.excerpt || '',
      author: meta.author || 'Syazani',
      content: fullContent
    };
    posts = posts.filter(p => p.slug !== slug);
    posts.push(newPost);
  }

  posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const putRes = await ghRequest(postsPath, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Update posts.json: ${action} ${slug}`,
      content: Buffer.from(JSON.stringify(posts, null, 2), 'utf8').toString('base64'),
      branch: process.env.GITHUB_BRANCH || 'main',
      ...(sha ? { sha } : {})
    })
  });

  if (!putRes.ok) {
    const e = await putRes.json();
    console.error('Gagal update posts.json:', e.message);
  }
}
