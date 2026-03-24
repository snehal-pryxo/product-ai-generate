import { createRequestListener } from "@react-router/node";
import * as serverBuild from "../build/server/index.js";

export default createRequestListener({
  build: serverBuild,
  mode: process.env.NODE_ENV || "production",
});
