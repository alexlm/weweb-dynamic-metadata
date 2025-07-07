import { config } from '../config.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const userAgent = request.headers.get('User-Agent') || '';
    
    // Always fetch from the WeWeb preview domain
    const originUrl = `${config.domainSource}${url.pathname}${url.search}`;
    
    console.log("Request for:", url.pathname);
    console.log("Fetching from:", originUrl);
    
    // Fetch from origin
    const response = await fetch(originUrl, {
      method: request.method,
      headers: {
        ...Object.fromEntries(request.headers.entries()),
        'Host': new URL(config.domainSource).host,
        'Origin': config.domainSource,
        'Referer': config.domainSource + '/'
      },
      body: request.body
    });
    
    // Get content type
    const contentType = response.headers.get('Content-Type') || '';
    
    // For non-HTML responses, pass through as-is
    if (!contentType.includes('text/html')) {
      console.log("Non-HTML content, passing through:", url.pathname);
      return response;
    }
    
    // For HTML responses, check if it's a bot
    const isBot = /bot|crawler|spider|crawling|facebookexternalhit|whatsapp|telegram|twitter|pinterest|linkedin|slack|discord/i.test(userAgent);
    
    console.log("HTML response, Is Bot:", isBot);
    
    // If not a bot, just pass through with modified headers
    if (!isBot) {
      const headers = new Headers(response.headers);
      headers.delete('X-Robots-Tag');
      return new Response(response.body, {
        status: response.status,
        headers: headers
      });
    }
    
    // For bots, apply metadata transformations
    console.log("Bot detected, checking for pattern match");
    
    // Function to get the pattern configuration that matches the URL
    function getPatternConfig(pathname) {
      for (const patternConfig of config.patterns) {
        const regex = new RegExp(patternConfig.pattern);
        let testPath = pathname + (pathname.endsWith('/') ? '' : '/');
        if (regex.test(testPath)) {
          return patternConfig;
        }
      }
      return null;
    }
    
    async function requestMetadata(pathname, metaDataEndpoint) {
      const trimmedUrl = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
      const parts = trimmedUrl.split('/');
      const id = parts[parts.length - 1];
      
      const placeholderPattern = /{([^}]+)}/;
      const metaDataEndpointWithId = metaDataEndpoint.replace(placeholderPattern, id);
      
      const metaDataResponse = await fetch(metaDataEndpointWithId);
      const metadata = await metaDataResponse.json();
      return metadata;
    }
    
    const patternConfig = getPatternConfig(url.pathname);
    
    if (patternConfig) {
      console.log("Pattern matched, fetching metadata");
      
      const metadata = await requestMetadata(url.pathname, patternConfig.metaDataEndpoint);
      console.log("Metadata fetched:", metadata);
      
      // Remove X-Robots-Tag
      const headers = new Headers(response.headers);
      headers.delete('X-Robots-Tag');
      
      // Create response with modified headers
      const modifiedResponse = new Response(response.body, {
        status: response.status,
        headers: headers
      });
      
      // Apply metadata transformations
      const customHeaderHandler = new CustomHeaderHandler(metadata);
      return new HTMLRewriter()
        .on('*', customHeaderHandler)
        .transform(modifiedResponse);
    }
    
    // No pattern match for bot, just remove X-Robots-Tag
    const headers = new Headers(response.headers);
    headers.delete('X-Robots-Tag');
    return new Response(response.body, {
      status: response.status,
      headers: headers
    });
  }
};

// CustomHeaderHandler class to modify HTML content based on metadata
class CustomHeaderHandler {
  constructor(metadata) {
    this.metadata = metadata;
  }

  element(element) {
    // Replace the <title> tag content
    if (element.tagName == "title") {
      console.log('Replacing title tag content');
      element.setInnerContent(this.metadata.title);
    }
    // Replace meta tags content
    if (element.tagName == "meta") {
      const name = element.getAttribute("name");
      switch (name) {
        case "title":
          element.setAttribute("content", this.metadata.title);
          break;
        case "description":
          element.setAttribute("content", this.metadata.description);
          break;
        case "image":
          element.setAttribute("content", this.metadata.image);
          break;
        case "keywords":
          element.setAttribute("content", this.metadata.keywords);
          break;
        case "twitter:title":
          element.setAttribute("content", this.metadata.title);
          break;
        case "twitter:description":
          element.setAttribute("content", this.metadata.description);
          break;
      }

      const itemprop = element.getAttribute("itemprop");
      switch (itemprop) {
        case "name":
          element.setAttribute("content", this.metadata.title);
          break;
        case "description":
          element.setAttribute("content", this.metadata.description);
          break;
        case "image":
          element.setAttribute("content", this.metadata.image);
          break;
      }

      const type = element.getAttribute("property");
      switch (type) {
        case "og:title":
          console.log('Replacing og:title');
          element.setAttribute("content", this.metadata.title);
          break;
        case "og:description":
          console.log('Replacing og:description');
          element.setAttribute("content", this.metadata.description);
          break;
        case "og:image":
          console.log('Replacing og:image');
          element.setAttribute("content", this.metadata.image);
          break;
      }

      // Remove the noindex meta tag
      const robots = element.getAttribute("name");
      if (robots === "robots" && element.getAttribute("content") === "noindex") {
        console.log('Removing noindex tag');
        element.remove();
      }
    }
  }
}
