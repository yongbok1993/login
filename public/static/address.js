// 카카오(다음) 우편번호 서비스로 도로명 주소 검색. 서비스 스크립트가 없으면 아무것도 하지 않는다(직접 입력).
(function () {
  var button = document.getElementById('address-search');
  if (!button) return;
  var layer = document.getElementById('postcode-layer');
  var box = document.getElementById('postcode-box');
  var close = document.getElementById('postcode-close');
  var postcode = document.getElementById('postcode');
  var address = document.getElementById('address');
  var detail = document.getElementById('address_detail');

  function Postcode() {
    return (window.kakao && window.kakao.Postcode) || (window.daum && window.daum.Postcode) || null;
  }

  function hide() {
    layer.hidden = true;
    box.innerHTML = '';
  }

  function onComplete(data) {
    var road = data.roadAddress || data.address || '';
    var extra = [];
    if (data.bname && /[동로가]$/.test(data.bname)) extra.push(data.bname);
    if (data.buildingName && data.apartment === 'Y') extra.push(data.buildingName);
    postcode.value = data.zonecode || '';
    address.value = extra.length ? road + ' (' + extra.join(', ') + ')' : road;
    hide();
    detail.focus();
  }

  if (!Postcode()) return;
  button.hidden = false;
  button.addEventListener('click', function () {
    var P = Postcode();
    if (!P) { address.focus(); return; }
    layer.hidden = false;
    new P({ oncomplete: onComplete, width: '100%', height: '100%' }).embed(box);
    close.focus();
  });
  close.addEventListener('click', function () { hide(); button.focus(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !layer.hidden) { hide(); button.focus(); }
  });
})();
