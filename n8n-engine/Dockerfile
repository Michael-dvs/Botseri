ARG N8N_VERSION=1.64.1
FROM n8nio/n8n:${N8N_VERSION}

USER root
RUN apk add --no-cache curl ca-certificates jq gettext
COPY entrypoint.sh /entrypoint.sh
COPY credentials.template.json /credentials.template.json
COPY workflows /workflows
RUN chmod +x /entrypoint.sh
USER node
ENTRYPOINT ["/entrypoint.sh"]
