import {CodeBuilder, SourceWriter} from "code-builder";
import babelParser from "babel-core/lib/helpers/parse.js";

export default function vectorize(scalarFunction, maxDimension, scalarVectorSpec, vectorizedHelperFunctions, context) {
	scalarFunction[1] = scalarFunction;

	for (let d = 2; d <= maxDimension; d++) {
		scalarFunction[d] = vectorizeFor(scalarFunction, d, scalarVectorSpec, vectorizedHelperFunctions, context);
		scalarFunction[d][1] = scalarFunction;
	}
}

function vectorizeFor(scalarFunction, vectorDimensions, scalarVectorSpec, vectorizedHelperFunctions, context) {
	let parseResult = babelParser(scalarFunction.toString());
	let funcDeclaration = parseResult.program.body[0];

	let cb = new CodeBuilder();
	let source = new SourceWriter();

	let args = new Map();
	for (let [i, {name}] of funcDeclaration.params.entries()) {
		switch (scalarVectorSpec[i][0]) {
			case "s": args.set(name, cb.scalar(name)); break;
			case "v": args.set(name, cb.vector(vectorDimensions, name + vectorDimensions + "d")); break;
			default: throw "Unknown type for function argument";
		}
	}

let vars = new Map(args);

function trans(node) {switch (node.type) {
	case "Literal": return cb.scalar(node.value);
	case "ReturnStatement": return cb.output(trans(node.argument));
	case "BinaryExpression":
		let left = trans(node.left);
		let right = trans(node.right);
		if (left.isVector || right.isVector) return cb.map(node.operator, left, right);
		else return cb.apply(node.operator, left, right);
	case "UnaryExpression":
		let op = node.operator === "-" ? "[[negate]]" : node.operator;
		let arg = trans(node.argument);
		if (arg.isVector) return cb.map(op, arg);
		else return cb.apply(op, arg);
	case "ArrayExpression":
		return cb.apply.apply(cb, ["[]"].concat([...node.elements.values().map(trans)]));
	case "ConditionalExpression":
		return cb.phi(transformTest(node.test), trans(node.consequent), trans(node.alternate));
	case "CallExpression":
		// !!!! scalar vars are wrapped in [] !!!
		return cb.apply.apply(cb, [trans(node.callee)].concat([...node.arguments.values().map(trans)]));
	case "VariableDeclaration":
		for (let assignment of node.declarations)
		vars.set(assignment.id.name, trans(assignment.init));
		return;
	case "BlockStatement":
		let blockResult;
		for (let statement of node.body)
		blockResult = trans(statement)
		return blockResult;
	case "Identifier":
		if (node.name === "undefined") return cb.scalar("undefined");
		if (Object.keys(vectorizedHelperFunctions).indexOf(node.name) !== -1)
			return cb.scalar(node.name + "[" + vectorDimensions + "]");
		let variable = vars.get(node.name);
		if (!variable) throw "No variable: " + node.name;
		return variable;
	default: throw "Unsupported statement for vectorization: " + node.type;
}}

function transformTest(node) {switch (node.type) {
	case "BinaryExpression": return [trans(node.left), node.operator, trans(node.right)];
	case "Identifier": return [trans(node), "", ""];
	default: throw "Unsupported conditional test";
}}

try {
	let body = trans(funcDeclaration.body);

	source.tab();
	cb.write(source, [body]);
	source.untab();

	return CodeBuilder.compile(
		funcDeclaration.id.name + vectorDimensions + "d",
		[...args.values()].map(v => v.name),
	source.string,
		context,
		vectorizedHelperFunctions
);
} catch (e) {
	console.error(scalarFunction.toString());
	console.error(source.string);
	console.error("Vectorization failed! " + e);
	throw e;
}
}