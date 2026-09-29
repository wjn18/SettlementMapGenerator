package;

import com.watabou.towngenerator.building.Model;
import com.watabou.towngenerator.building.CurtainWall;
import com.watabou.towngenerator.wards.Castle;
import com.watabou.towngenerator.Main;
import com.watabou.towngenerator.StateManager;
import com.watabou.coogee.BitmapText;
import com.watabou.geom.Polygon;
import com.watabou.utils.Random;
import openfl.geom.Point;

// Observation only: never consumes randomness or writes to the model.
// Each capture copies coordinates immediately, before later stages mutate Points.
@:access(com.watabou.towngenerator.building.Model)
class Baseline {
    public static var attempts:Array<Dynamic> = [];
    static var stages:Array<Dynamic>;

    public static function begin():Void {
        stages = [];
        attempts.push({stages: stages, error: null});
    }

    public static function failed(message:String):Void {
        Reflect.setField(attempts[attempts.length - 1], "error", message);
    }

    public static function capture(name:String, model:Model):Void {
        var points:Array<Point> = [];
        var vertices:Array<Dynamic> = [];
        // indexOf preserves identity without adding ObjectMap IDs to observed Points.
        function vertex(p:Point):Int {
            var id = points.indexOf(p);
            if (id < 0) {
                id = points.length;
                points.push(p);
                vertices.push({id: id, x: p.x, y: p.y});
            }
            return id;
        }
        function ring(shape:Polygon):Array<Int> {
            return shape == null ? [] : [for (p in shape) vertex(p)];
        }
        function wall(value:CurtainWall):Dynamic {
            return value == null ? null : {
                boundary: ring(value.shape), segments: value.segments.copy(),
                gates: value.gates == null ? [] : [for (p in value.gates) vertex(p)],
                towers: value.towers == null ? [] : [for (p in value.towers) vertex(p)]
            };
        }
        var patches:Array<Dynamic> = [];
        for (i in 0...model.patches.length) {
            var patch = model.patches[i];
            patches.push({id: i, boundary: ring(patch.shape), withinCity: patch.withinCity,
                withinWalls: patch.withinWalls,
                ward: patch.ward == null ? null : Type.getClassName(Type.getClass(patch.ward)),
                geometry: patch.ward == null || patch.ward.geometry == null ? [] : [for (shape in patch.ward.geometry) ring(shape)]});
        }
        var castle = model.citadel != null && Std.is(model.citadel.ward, Castle) ? cast(model.citadel.ward, Castle) : null;
        var snapshot:Dynamic = {
            stage: name, randomState: Random.getSeed(),
            features: {plaza: model.plazaNeeded, castle: model.citadelNeeded, walls: model.wallsNeeded},
            vertices: vertices, patches: patches,
            inner: [for (p in model.inner) model.patches.indexOf(p)],
            plaza: model.patches.indexOf(model.plaza), citadel: model.patches.indexOf(model.citadel),
            center: model.center == null ? null : vertex(model.center),
            streets: model.streets == null ? [] : [for (s in model.streets) ring(s)],
            roads: model.roads == null ? [] : [for (s in model.roads) ring(s)],
            arteries: model.arteries == null ? [] : [for (s in model.arteries) ring(s)],
            border: wall(model.border), wall: wall(model.wall), castleWall: castle == null ? null : wall(castle.wall),
            gates: model.gates == null ? [] : [for (p in model.gates) vertex(p)]
        };
        stages.push(snapshot);
    }

    public static function finish():Void {
        var text = "Small Town 12345";
        var font = Main.uiFont;
        var label = new BitmapText(font, text);
        var glyphs = [for (i in 0...text.length) {
            var rect = font.table[text.charAt(i)];
            {x: rect.x, width: rect.width};
        }];
        var result = {format: "legacy-stage-baseline-1", seed: StateManager.seed, size: StateManager.size,
            attempts: attempts, finalRandomState: Random.getSeed(),
            font: {width: label.bitmapData.width, height: label.bitmapData.height, glyphs: glyphs}};
        label.bitmapData.dispose();
        Reflect.setField(js.Browser.window, "__legacyBaseline", result);
    }
}
