import { errors } from "@elastic/elasticsearch";

import ESWrapper from "../../lib/esWrapper";
import { describeESWrapper } from "./esWrapperCases";

describeESWrapper("9", ESWrapper as never, errors.ResponseError as never);
