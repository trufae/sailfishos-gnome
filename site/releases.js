/* Release assets remain on GitHub Releases, outside the Pages deployment. */
(async () => {
  const status = document.getElementById('release-status');
  const list = document.getElementById('release-assets');
  try {
    const response = await fetch('https://api.github.com/repos/trufae/sailfishos-gnome/releases/latest', {
      headers: {Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(8000)
    });
    if (response.status === 404) return;
    if (!response.ok) throw new Error('Release service unavailable');
    const release = await response.json();
    const assets = release.assets || [];
    const links = [
      ['Runtime RPM', /^sailfish-gnome-\d.*\.aarch64\.rpm$/],
      ['Development RPM', /^sailfish-gnome-devel-\d.*\.aarch64\.rpm$/],
      ['CI bundle', /^sailfish-gnome-.*-aarch64\.tar\.gz$/],
      ['Corresponding sources', /-sources\.tar\.xz$/],
      ['Checksums', /^SHA256SUMS$/],
      ['CI lock file', /^sailfish-gnome\.lock$/]
    ];
    for (const [label, pattern] of links) {
      const asset = assets.find(item => pattern.test(item.name));
      if (!asset) continue;
      const url = new URL(asset.browser_download_url);
      if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/trufae/sailfishos-gnome/releases/download/')) continue;
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = url.href;
      link.textContent = label;
      item.append(link);
      list.append(item);
    }
    status.textContent = list.children.length ? `${release.tag_name} · Check SHA256SUMS before installing.` : 'See the release notes for package availability.';
  } catch {
    status.textContent = 'The release list could not be loaded. Browse all releases for downloads.';
  }
})();
