# Custom image for a ModelArts real-time service. Build from the repository root:
#   docker build -f ml/modelarts/Dockerfile -t biocanary-inference .
FROM python:3.12-slim
RUN pip install --no-cache-dir "numpy>=2" && useradd -u 1000 ma-user
WORKDIR /srv
COPY backend/app/__init__.py runtime/app/__init__.py
COPY backend/app/analysis/__init__.py runtime/app/analysis/__init__.py
COPY backend/app/analysis/model_runtime.py runtime/app/analysis/model_runtime.py
COPY ml/artifacts/inhibition_classifier.json model/inhibition_classifier.json
COPY ml/modelarts/inference_server.py inference_server.py
ENV BIOCANARY_RUNTIME=/srv/runtime MODEL_PATH=/srv/model/inhibition_classifier.json PORT=8080
USER ma-user
EXPOSE 8080
CMD ["python", "inference_server.py"]
