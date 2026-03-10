// CRAのデフォルトproxyは拡張子付きパス（例: 1332.T）を
// ファイルと誤認して503を返す。明示的にミドルウェアで設定する。
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:3001',
      changeOrigin: true,
    })
  );
};
