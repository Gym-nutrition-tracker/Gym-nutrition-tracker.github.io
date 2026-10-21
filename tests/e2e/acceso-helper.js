/* AUTH-04: sin sesión, la app abre en la pantalla de acceso. Los e2e que
   prueban la app en modo local esperan a que termine el arranque y, si
   aparece el acceso, tocan "Seguir sin cuenta". Contra una versión base
   anterior a AUTH-04 (sin acceso) no hace nada. */
async function seguirSinCuenta(page) {
  await page.waitForFunction(() => {
    const r = document.getElementById("app-root");
    return !!(r && r.firstElementChild && !r.querySelector(".pantalla-cargando"));
  });
  if (await page.$(".pantalla-acceso")) await page.click('[data-accion="acceso-sin-cuenta"]');
}

module.exports = { seguirSinCuenta };
