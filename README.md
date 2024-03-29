# sitespeed.io plugin for running WebPageTest

Run WebPageTest as a plugin for sitespeed.io.

You can read more about sitespeed.io plugins [here](https://www.sitespeed.io/documentation/sitespeed.io/plugins/).



## Maintainer needed
We are looking for someone that can give some love to the WebPageTest plugin. You are probably working at Catchpoint and gets paid to promote WebPageTest. Ping us by [creating a issue](https://github.com/sitespeedio/plugin-webpagetest/issues/new)!

## Test with current main

If you have checked out as the same level as sitespeed.io you run it like this (else just change the path).

```bash
git clone https://github.com/sitespeedio/sitespeed.io.git
cd sitespeed.io
npm install
bin/sitespeed.js --plugins.add ../plugin-webpagetest/index.js https://www.sitespeed.io/ -n 1 --webpagetest.key YOUR_KEY
```

## Run in production
If you want to run WebPageTest with your other sitespeed.io test, follow the instructions in the [add a plugin docs](https://www.sitespeed.io/documentation/sitespeed.io/plugins/#add-a-plugin) or use the sitespeed.io-webpagetest container. Read the [documentation](https://www.sitespeed.io/documentation/sitespeed.io/webpagetest/).
## sitespeed.io version

You need sitespeed.io 27.0 or later to run the plugin.
