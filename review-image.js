const url = decodeURIComponent(location.hash.slice(1));
if (url.startsWith('blob:chrome-extension://' + chrome.runtime.id + '/')) {
  const image = document.querySelector('#review-image');
  image.onload = () => {
    document.body.style.width = image.naturalWidth + 'px';
    document.body.dataset.ready = 'true';
  };
  image.onerror = () => {
    document.body.textContent =
      '미리보기가 만료됐습니다. 편집기에서 전달 이미지를 다시 요청해 주세요.';
  };
  image.src = url;
} else document.body.textContent = '유효한 전달 이미지가 아닙니다.';
