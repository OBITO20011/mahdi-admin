// A JSON response may split anywhere, including inside an Arabic UTF-8 codepoint.
export function consumeScaleUtf8(stream,onText){stream.setEncoding('utf8');stream.on('data',onText);}
