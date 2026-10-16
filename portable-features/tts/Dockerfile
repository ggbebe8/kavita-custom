FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgomp1 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY model.py server.py ./
RUN useradd --uid 10001 --create-home tts && mkdir /data && chown tts:tts /data
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=2)"
CMD ["python", "server.py"]
