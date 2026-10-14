// 인쇄 버튼: 스크립트가 있을 때만 보이고, 누르면 브라우저 인쇄(A4 인쇄 스타일은 styles.css @media print).
document.querySelectorAll('[data-print]').forEach(function (btn) {
  btn.hidden = false;
  btn.addEventListener('click', function () { window.print(); });
});
