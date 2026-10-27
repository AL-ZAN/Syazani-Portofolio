// api/list-posts.js
// Serverless function: baca daftar artikel dari GitHub

const GITHUB_API = 'https://api.github.com';

async function ghRequest(path) {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_REPO_OWNER;
  const repo = process.env.GITHUB_REPO_NAME;
  const branch = process.env.GITHUB_BRANCH || 'main';

  if (!token || !owner || !repo) {
    throw new Error('Environment variable belum diset');
  }

  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  return fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'syazani-portfolio-admin'
    }
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const listRes = await ghRequest('posts');
    if (listRes.status === 404) {
      return res.status(200).json([]);
    }
    if (!listRes.ok) {
      const e = await listRes.json();
      return res.status(500).json({ error: 'Gagal list: ' + (e.message || 'unknown') });
    }
    const files = await listRes.json();
    const mdFiles = (Array.isArray(files) ? files : []).filter(f => f.name.endsWith('.md'));

    const posts = [];
    for (const file of mdFiles) {
      const fileRes = await ghRequest(`posts/${file.name}`);
      if (!fileRes.ok) continue;
      const fileData = await fileRes.json();
      const md = Buffer.from(fileData.content, 'base64').toString('utf8');
      const fm = parseFrontmatter(md);
      posts.push({
        slug: file.name.replace(/\.md$/, ''),
        title: fm.title || file.name.replace(/\.md$/, ''),
        date: fm.date || '',
        excerpt: fm.excerpt || '',
        author: fm.author || 'Syazani',
        content: fm.body || ''
      });
    }

    posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return res.status(200).json(posts);
  } catch (err) {
    console.error('list-posts error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
};

function parseFrontmatter(md) {
  const out = { title: '', date: '', excerpt: '', author: '', body: md };
  const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!m) return out;
  const yaml = m[1];
  out.body = m[2];
  yaml.split('\n').forEach(line => {
    const idx = line.indexOf(':');
    if (idx < 0) return;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key in out) out[key] = val;
  });
  return out;
}
