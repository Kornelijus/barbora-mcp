# A session is a cookie jar, and the password is not stored

The shop signs a shopper in by setting cookies. Password sign-in and browser sign-in both write that same cookie jar to the shopper's home directory and then forget the password. A bearer token was the alternative. The shop's own client sends `credentials: include` and does not keep a token in the page, so a jar matches the shop and lets Google, Facebook, and Apple sign-in work through the browser window.
