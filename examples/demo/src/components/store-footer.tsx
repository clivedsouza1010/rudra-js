export function StoreFooter() {
  return (
    <footer className="footer">
      <div className="footer__columns">
        <section>
          <h2 className="footer__heading">Help</h2>
          <ul>
            <li>
              <a href="#orders">Order status</a>
            </li>
            <li>
              <a href="#returns">Returns and exchanges</a>
            </li>
            <li>
              <a href="#shipping">Shipping</a>
            </li>
          </ul>
        </section>
        <section>
          <h2 className="footer__heading">Stores</h2>
          <ul>
            <li>
              <a href="#stores">Find a store</a>
            </li>
            <li>
              <a href="#rentals">Gear rentals</a>
            </li>
            <li>
              <a href="#repairs">Repairs</a>
            </li>
          </ul>
        </section>
        <section>
          <h2 className="footer__heading">This demo</h2>
          <ul>
            <li>
              <a href="https://rudrajs.com">What rudra-js is</a>
            </li>
            <li>
              <a href="https://github.com/clivedsouza1010/rudra-js/tree/main/examples/demo">
                The code for this page
              </a>
            </li>
          </ul>
        </section>
      </div>
      <p className="footer__note">
        Larchmere Outfitters is made up for a rudra-js demo. The products, prices and reviews are
        generated, and nothing here is for sale.
      </p>
    </footer>
  );
}
