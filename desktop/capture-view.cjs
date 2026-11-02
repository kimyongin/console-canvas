const { prepareCaptureView: prepare } = require('../capture/view.cjs');
function prepareCaptureView(contents, code, options) {
  return prepare(
    (expression) => contents.executeJavaScriptInIsolatedWorld(1002, [{ code: expression }]),
    code,
    options,
  );
}
module.exports = { prepareCaptureView };
