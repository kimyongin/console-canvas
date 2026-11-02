const source = decodeURIComponent(location.hash.slice(1));
const image = document.querySelector('#image');
image.onerror = () => {
  image.hidden = true;
  document.querySelector('#error').hidden = false;
};
if (source.startsWith('blob:' + location.origin + '/')) image.src = source;
else image.onerror();
