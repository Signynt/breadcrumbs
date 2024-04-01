import { DateTime } from "luxon";
import type {
	BreadcrumbsError,
	ExplicitEdgeBuilder,
} from "src/interfaces/graph";
import { get_field_hierarchy } from "src/utils/hierarchies";
import { Paths } from "src/utils/paths";

export const _add_explicit_edges_date_note: ExplicitEdgeBuilder = (
	graph,
	plugin,
	all_files,
) => {
	const errors: BreadcrumbsError[] = [];

	const date_note_settings = plugin.settings.explicit_edge_sources.date_note;
	if (!date_note_settings.enabled) return { errors };

	const field_hierarchy = get_field_hierarchy(
		plugin.settings.hierarchies,
		date_note_settings.default_field,
	);
	if (!field_hierarchy) {
		errors.push({
			code: "invalid_setting_value",
			message: `date_note.default_field is not a valid BC field: '${date_note_settings.default_field}'`,
			path: "settings.explicit_edge_sources.date_note.default_field",
		});

		return { errors };
	}

	const date_note_files: {
		ext: string;
		path: string;
		folder: string;
		basename: string;
		date: DateTime<true>;
	}[] = [];

	// Basically just converting the two all_files into a common format of their basic fields...
	// Maybe generalise this?
	all_files.obsidian?.forEach(({ file }) => {
		const date = DateTime.fromFormat(
			file.basename,
			date_note_settings.date_format,
		);
		if (!date.isValid) return;

		date_note_files.push({
			date,
			ext: file.extension,
			path: file.path,
			basename: file.basename,
			// Not sure why would this be undefined?
			//   I tested and a file in the root of the vault still has a parent
			//   _it's_ parent is null, but that only happens if "file" is actually a folder
			folder: file.parent?.path ?? "",
		});
	});

	all_files.dataview?.forEach(({ file }) => {
		const date = DateTime.fromFormat(
			file.name,
			date_note_settings.date_format,
		);
		if (!date.isValid) return;

		date_note_files.push({
			date,
			ext: file.ext,
			path: file.path,
			folder: file.folder,
			basename: file.name,
		});
	});

	date_note_files
		.sort((a, b) => a.date.toMillis() - b.date.toMillis())
		.forEach((date_note, i) => {
			const basename_plus_one_day = date_note.date
				.plus({ days: 1 })
				.toFormat(date_note_settings.date_format);

			const target_basename = date_note_settings.stretch_to_existing
				? date_note_files.at(i + 1)?.basename ?? basename_plus_one_day
				: basename_plus_one_day;

			const target_path = Paths.build(
				date_note.folder,
				target_basename,
				date_note.ext,
			);

			// NOTE: We have a full path, so we can go straight to the file without the given source_path
			const target_file = plugin.app.vault.getFileByPath(target_path);
			if (!target_file) {
				graph.safe_add_node(target_path, { resolved: false });
			}

			graph.safe_add_directed_edge(date_note.path, target_path, {
				explicit: true,
				source: "date_note",
				dir: field_hierarchy.dir,
				field: date_note_settings.default_field,
				hierarchy_i: field_hierarchy.hierarchy_i,
			});
		});

	return { errors };
};
