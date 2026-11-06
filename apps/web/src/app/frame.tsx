// Frame buster. GitHub Pages cannot send frame-ancestors / X-Frame-Options, so another page could show Cairn in a frame and trick
// clicks on its buttons (a network switch, a profile save, an approval). A same-site frame even shares Cairn's storage and session.
// There is no reason to embed Cairn, so inside a frame it renders only a way out.

/** Whether Cairn is shown inside another page's frame. */
export function isFramed(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true; // a cross-origin parent can make even the comparison throw
  }
}

export function FramedNotice() {
  return (
    <main className="main">
      <section className="page-narrow" data-testid="framed-notice">
        <h1>Cairn only works in its own tab</h1>
        <p>
          This page shows Cairn inside another site, where clicks can be redirected without you seeing it. Nothing here can be changed from inside a
          frame.
        </p>
        <p>
          <a className="btn btn-primary" href={location.href} target="_blank" rel="noopener noreferrer">
            Open Cairn in its own tab
          </a>
        </p>
      </section>
    </main>
  );
}
