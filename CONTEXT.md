# Hosted trigger terms

**Progress cursor**: the existing hosted-trigger cursor plus opaque provider-owned JSON state naming the next feed position; the host retains and returns that state without interpreting it.

**Pending page**: an exact bounded provider response normalized into events and its proposed continuation, retained before admission; it remains replayable until every event is admitted and the continuation is committed. _Avoid_: advanced cursor, delivered page.
