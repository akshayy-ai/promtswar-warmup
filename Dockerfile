FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY style.css  /usr/share/nginx/html/style.css
COPY app.js     /usr/share/nginx/html/app.js
EXPOSE 8080
# Replace placeholder with GEMINI_API_KEY env var at container startup, then start nginx
CMD ["/bin/sh", "-c", "sed -i \"s|__GEMINI_DEFAULT_KEY__|${GEMINI_API_KEY:-}|g\" /usr/share/nginx/html/app.js && nginx -g 'daemon off;'"]
