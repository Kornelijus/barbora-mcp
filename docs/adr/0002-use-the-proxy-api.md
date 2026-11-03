# Talk to the shop through `/proxy/api/v1`

Lithuania still serves an older storefront, and Estonia and Latvia are already on the newer one. Both talk to `https://barbora.{lt|ee|lv}/proxy/api/v1` with an `x-target` for the shop. The older `/api/eshop/v1` paths still answer on Lithuania. New work uses the proxy so one client covers all three shops. The public catalog calls need no session. Cart, slot, and checkout do.
