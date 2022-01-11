import {createApp} from "./app";

const app = createApp();
console.log("Listening");
app.listen(parseInt(process.env.PORT || "3000"));