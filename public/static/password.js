// 비밀번호 보기/숨기기. 스크립트가 없으면 버튼은 숨겨진 채로 두고 입력은 그대로 가려진다.
document.querySelectorAll('.pw-toggle').forEach(function (btn) {
  var input = document.getElementById(btn.getAttribute('data-target'));
  if (!input) return;
  btn.hidden = false;
  btn.addEventListener('click', function () {
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? '숨기기' : '보기';
    btn.setAttribute('aria-pressed', show ? 'true' : 'false');
    input.focus();
  });
});
