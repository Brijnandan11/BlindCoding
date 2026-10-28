FROM gcc:14-bookworm
COPY runner.py /runner.py
USER 65534:65534
WORKDIR /work
ENTRYPOINT ["python3", "/runner.py"]
