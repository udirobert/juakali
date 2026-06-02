import express from "express";
import { voiceRouter } from "./routes/voice.js";
import { smsRouter } from "./routes/sms.js";
import { ussdRouter } from "./routes/ussd.js";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get("/health", (_req, res) => {
    res.type("text/plain").send("JuaKali Agent is ready");
});

app.use("/webhooks/voice", voiceRouter);
app.use("/webhooks/sms", smsRouter);
app.use("/webhooks/ussd", ussdRouter);

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => {
    console.log(`JuaKali Agent listening on port ${port}`);
});
