import { config } from '../config.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const userAgent = request.headers.get('User-Agent') || '';
    
    // Check if this is a bot/crawler request
    // Note: LinkedIn in-app browser should NOT be treated as a bot
    const isBot = /bot|crawler|spider|crawling|facebookexternalhit|whatsapp|telegram|twitter|pinterest|slack|discord/i.test(userAgent) 
                  && !/LinkedIn/.test(userAgent);  // Exclude LinkedIn app browser
    
    // Log the user agent for debugging
    console.log("User-Agent:", userAgent);
    console.log("Is Bot:", isBot);
    
    // Specifically check for LinkedIn in-app browser
    const isLinkedInBrowser = /LinkedIn/i.test(userAgent);
    
    // Check if this is the initial page request (not an asset)
    const isPageRequest = !url.pathname.includes('/assets/') && 
                         !url.pathname.includes('/fonts/') &&
                         !url.pathname.includes('/images/') &&
                         !url.pathname.endsWith('.js') &&
                         !url.pathname.endsWith('.css') &&
                         !url.pathname.endsWith('.png') &&
                         !url.pathname.endsWith('.jpg') &&
                         !url.pathname.endsWith('.ico');
    
    // Check if this is a page data JSON request
    const isPageDataRequest = /\/public\/data\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json/.test(url.pathname);
    
    console.log("Request:", url.pathname);
    console.log("Is Bot:", isBot);
    console.log("Is LinkedIn Browser:", isLinkedInBrowser);
    console.log("Is Page Request:", isPageRequest);
    
    // For non-page requests (assets, API calls, etc.), redirect to WeWeb directly
    // EXCEPT for page data JSON files which we need to modify
    if (!isPageRequest && !isPageDataRequest) {
      console.log("Asset request, redirecting to WeWeb:", url.pathname);
      
      // LinkedIn browser might have issues with redirects, so proxy instead
      if (isLinkedInBrowser) {
        console.log("LinkedIn browser detected, proxying asset instead of redirecting");
        return fetch(`${config.domainSource}${url.pathname}${url.search}`);
      }
      
      return Response.redirect(`${config.domainSource}${url.pathname}${url.search}`, 302);
    }
    
    console.log("Processing request:", url.pathname);
    console.log("Is page request:", isPageRequest);
    console.log("Is page data request:", isPageDataRequest);
    
    // Helper functions
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
    
    // For page requests, fetch and process
    const originUrl = `${config.domainSource}${url.pathname}${url.search}`;
    const response = await fetch(originUrl);
    
    // Handle page data JSON requests
    if (isPageDataRequest) {
      console.log("Page data JSON detected:", url.pathname);
      const referer = request.headers.get('Referer');
      
      // Extract the pathname from the referer
      let pathname = null;
      if (referer) {
        try {
          const refererUrl = new URL(referer);
          pathname = refererUrl.pathname;
        } catch (e) {
          console.error("Invalid referer URL:", referer);
        }
      }
      
      if (pathname) {
        const patternConfig = getPatternConfig(pathname);
        if (patternConfig) {
          try {
            const metadata = await requestMetadata(pathname, patternConfig.metaDataEndpoint);
            console.log("Metadata fetched for JSON:", metadata);
            
            // Parse and modify the JSON
            let jsonData = await response.json();
            
            // Ensure nested objects exist
            jsonData.page = jsonData.page || {};
            jsonData.page.title = jsonData.page.title || {};
            jsonData.page.meta = jsonData.page.meta || {};
            jsonData.page.meta.desc = jsonData.page.meta.desc || {};
            jsonData.page.socialTitle = jsonData.page.socialTitle || {};
            jsonData.page.socialDesc = jsonData.page.socialDesc || {};
            
            // Update with metadata
            if (metadata.title) {
              jsonData.page.title.en = metadata.title;
              jsonData.page.title.fr = metadata.title; // Also set French
              jsonData.page.socialTitle.en = metadata.title;
              jsonData.page.socialTitle.fr = metadata.title;
            }
            if (metadata.description) {
              jsonData.page.meta.desc.en = metadata.description;
              jsonData.page.meta.desc.fr = metadata.description;
              jsonData.page.socialDesc.en = metadata.description;
              jsonData.page.socialDesc.fr = metadata.description;
            }
            if (metadata.image) {
              jsonData.page.metaImage = metadata.image;
            }
            
            // Return modified JSON
            return new Response(JSON.stringify(jsonData), {
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
              }
            });
          } catch (e) {
            console.error("Error processing page data:", e);
          }
        }
      }
      
      // If no pattern match or error, return original response
      return response;
    }
    
    // If not HTML, just return it
    const contentType = response.headers.get('Content-Type') || '';
    if (!contentType.includes('text/html')) {
      return response;
    }
    
    // For regular users (not bots), return a modified HTML that loads directly from WeWeb
    if (!isBot) {
      console.log("Regular user, modifying base URL and checking for title update");
      
      // Check if we need to update the title
      const patternConfig = getPatternConfig(url.pathname);
      let titleMetadata = null;
      
      if (patternConfig) {
        try {
          titleMetadata = await requestMetadata(url.pathname, patternConfig.metaDataEndpoint);
          console.log("Title metadata fetched for regular user:", titleMetadata.title);
        } catch (e) {
          console.error("Error fetching metadata:", e);
        }
      }
      
      // For LinkedIn browser, use a simpler approach without complex URL rewriting
      if (isLinkedInBrowser) {
        console.log("LinkedIn browser - using simplified response");
        
        const headers = new Headers(response.headers);
        headers.delete('X-Robots-Tag');
        
        // Only modify the title if we have metadata
        if (titleMetadata && titleMetadata.title) {
          const rewriter = new HTMLRewriter()
            .on('title', {
              element(element) {
                element.setInnerContent(titleMetadata.title);
              }
            });
          
          return rewriter.transform(new Response(response.body, {
            status: response.status,
            headers: headers
          }));
        }
        
        return new Response(response.body, {
          status: response.status,
          headers: headers
        });
      }
      
      // Regular browser - use full URL rewriting approach
      const rewriter = new HTMLRewriter()
        .on('base', {
          element(element) {
            // Update the base href to point to WeWeb
            element.setAttribute('href', config.domainSource + '/');
          }
        })
        .on('script[src], link[href]', {
          element(element) {
            const src = element.getAttribute('src');
            const href = element.getAttribute('href');
            
            if (src && src.startsWith('/')) {
              element.setAttribute('src', config.domainSource + src);
            }
            if (href && href.startsWith('/') && !href.startsWith('//')) {
              element.setAttribute('href', config.domainSource + href);
            }
          }
        });
      
      // Add title transformation if we have metadata
      if (titleMetadata && titleMetadata.title) {
        rewriter.on('title', {
          element(element) {
            element.setInnerContent(titleMetadata.title);
          }
        });
        
        // Inject a script to maintain the title
        rewriter.on('head', {
          element(element) {
            element.append(`
              <script>
                (function() {
                  const customTitle = ${JSON.stringify(titleMetadata.title)};
                  const metaDataEndpoint = ${JSON.stringify(patternConfig.metaDataEndpoint)};
                  const pattern = ${JSON.stringify(patternConfig.pattern)};
                  
                  // Set initial title
                  document.title = customTitle;
                  
                  // Function to fetch metadata for a given path
                  async function fetchTitleForPath(pathname) {
                    try {
                      // Check if the path matches our pattern
                      const regex = new RegExp(pattern);
                      const testPath = pathname + (pathname.endsWith('/') ? '' : '/');
                      if (!regex.test(testPath)) {
                        return null;
                      }
                      
                      // Extract ID from path
                      const trimmedUrl = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
                      const parts = trimmedUrl.split('/');
                      const id = parts[parts.length - 1];
                      
                      // Build metadata URL
                      const metaUrl = metaDataEndpoint.replace(/{[^}]+}/, id);
                      
                      // Fetch metadata
                      const response = await fetch(metaUrl);
                      const metadata = await response.json();
                      return metadata.title;
                    } catch (e) {
                      console.error('Error fetching title:', e);
                      return null;
                    }
                  }
                  
                  // Store the original setter
                  const originalTitleDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
                  const originalSet = originalTitleDescriptor.set;
                  
                  // Track current path
                  let currentPath = window.location.pathname;
                  
                  // Override title setter
                  Object.defineProperty(document, 'title', {
                    get: originalTitleDescriptor.get,
                    set: function(newTitle) {
                      // Check if we're on a recipe page
                      const regex = new RegExp(pattern);
                      const testPath = window.location.pathname + (window.location.pathname.endsWith('/') ? '' : '/');
                      
                      if (regex.test(testPath)) {
                        // If we're still on the same path, keep our custom title
                        if (window.location.pathname === currentPath) {
                          console.log('Keeping custom title:', document.title);
                          return;
                        }
                        
                        // Path changed, fetch new title
                        currentPath = window.location.pathname;
                        fetchTitleForPath(currentPath).then(title => {
                          if (title) {
                            originalSet.call(document, title);
                          } else {
                            originalSet.call(document, newTitle);
                          }
                        });
                      } else {
                        // Not a recipe page, use the default title
                        currentPath = window.location.pathname;
                        originalSet.call(document, newTitle);
                      }
                    }
                  });
                  
                  // Also listen for navigation events
                  let lastPath = window.location.pathname;
                  
                  // Check for path changes periodically
                  setInterval(async () => {
                    if (window.location.pathname !== lastPath) {
                      lastPath = window.location.pathname;
                      const regex = new RegExp(pattern);
                      const testPath = lastPath + (lastPath.endsWith('/') ? '' : '/');
                      
                      if (regex.test(testPath)) {
                        const title = await fetchTitleForPath(lastPath);
                        if (title) {
                          document.title = title;
                        }
                      }
                    }
                  }, 100);
                })();
              </script>
            `, { html: true });
          }
        });
      } else {
        // No pattern match, inject a simpler script that handles all navigation
        rewriter.on('head', {
          element(element) {
            element.append(`
              <script>
                (function() {
                  const patterns = ${JSON.stringify(config.patterns)};
                  
                  // Function to fetch metadata for a given path
                  async function fetchTitleForPath(pathname) {
                    try {
                      // Find matching pattern
                      for (const patternConfig of patterns) {
                        const regex = new RegExp(patternConfig.pattern);
                        const testPath = pathname + (pathname.endsWith('/') ? '' : '/');
                        if (regex.test(testPath)) {
                          // Extract ID from path
                          const trimmedUrl = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
                          const parts = trimmedUrl.split('/');
                          const id = parts[parts.length - 1];
                          
                          // Build metadata URL
                          const metaUrl = patternConfig.metaDataEndpoint.replace(/{[^}]+}/, id);
                          
                          // Fetch metadata
                          const response = await fetch(metaUrl);
                          const metadata = await response.json();
                          return metadata.title;
                        }
                      }
                      return null;
                    } catch (e) {
                      console.error('Error fetching title:', e);
                      return null;
                    }
                  }
                  
                  // Listen for navigation
                  let lastPath = window.location.pathname;
                  
                  setInterval(async () => {
                    if (window.location.pathname !== lastPath) {
                      lastPath = window.location.pathname;
                      const title = await fetchTitleForPath(lastPath);
                      if (title) {
                        document.title = title;
                      }
                    }
                  }, 100);
                })();
              </script>
            `, { html: true });
          }
        });
      }
      
      const headers = new Headers(response.headers);
      headers.delete('X-Robots-Tag');
      
      return rewriter.transform(new Response(response.body, {
        status: response.status,
        headers: headers
      }));
    }
    
    // For bots, apply metadata transformations
    console.log("Bot detected, checking for pattern match");
    
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
