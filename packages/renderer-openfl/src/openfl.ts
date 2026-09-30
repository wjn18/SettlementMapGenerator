import StageModule from 'openfl/lib/openfl/display/Stage';
import SpriteModule from 'openfl/lib/openfl/display/Sprite';
import CapsModule from 'openfl/lib/openfl/display/CapsStyle';
import JointsModule from 'openfl/lib/openfl/display/JointStyle';
import ScaleModule from 'openfl/lib/openfl/display/LineScaleMode';
// OpenFL's CJS default can be wrapped twice by Vite; normalize at the boundary.
function unwrap<T>(module: T): T { return (module as { default?: T }).default ?? module; }
export const Stage = unwrap(StageModule), Sprite = unwrap(SpriteModule);
export const CapsStyle = unwrap(CapsModule), JointStyle = unwrap(JointsModule), LineScaleMode = unwrap(ScaleModule);
