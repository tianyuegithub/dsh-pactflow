ARG BASE_IMAGE=192.168.31.200:8080/datavdl/pactflow-worker@sha256:3342bb490d91ff8e39255e4b0e477967f4ccd9c7fb4380a1ec13cc654debdcea
FROM ${BASE_IMAGE}
USER root
COPY lib/ /opt/pactflow-worker/lib/
COPY worker/dsh/runner.sh worker/dsh/runner.mjs worker/dsh/connect.mjs worker/dsh/runtime-manifest.json /opt/pactflow-worker/
RUN ln -s /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules /opt/pactflow-worker/node_modules \
 && chmod -R go-w /opt/pactflow-worker && chmod 755 /opt/pactflow-worker/runner.sh
USER 1001:1001
