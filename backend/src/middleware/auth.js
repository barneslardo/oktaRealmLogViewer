export function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  // API routes return 401; page routes redirect to login
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.session.returnTo = req.originalUrl;
  res.redirect('/auth/login');
}
