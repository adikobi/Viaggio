const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
const base = process.env.GITHUB_ACTIONS && repo ? `/${repo}` : '';
export default { output: 'export', basePath: base, images: { unoptimized: true }, env: { NEXT_PUBLIC_BASE_PATH: base } };
